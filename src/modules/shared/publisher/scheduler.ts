import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { publishQueue } from '../../../queues/queues.js';

/**
 * Publisher 스케줄러 (Task #20).
 *
 * 승인된 Post를 실 발행하기 전에 계정별 안전 정책 적용:
 *   1) 계정별 활성 시간대(activeHourStart~End) 존중
 *   2) 계정 간 최소 시차(PUBLISH_ACCOUNT_MIN_GAP_MINUTES) 유지
 *   3) 계정별 일일 발행 상한 (기본 1건, 확장 가능)
 *   4) BullMQ delayed job으로 지정 시각에 실행
 *
 * scheduleApprovedPost(postId):
 *   - Post 상태 검증 (APPROVED만)
 *   - 해당 계정의 마지막 발행 시각 조회
 *   - 최소 시차 · 활성 시간대 · 일일 상한 검사 → 발행 시각 계산
 *   - Post.scheduledAt 갱신
 *   - publishQueue.add({postId}, {delay})
 */

const MIN_GAP_MS = env.PUBLISH_ACCOUNT_MIN_GAP_MINUTES * 60 * 1000;
const MAX_GAP_MS = env.PUBLISH_ACCOUNT_MAX_GAP_MINUTES * 60 * 1000;

export class SchedulerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'POST_NOT_FOUND'
      | 'POST_INVALID_STATE'
      | 'ACCOUNT_INACTIVE'
      | 'DAILY_LIMIT_REACHED',
  ) {
    super(message);
    this.name = 'SchedulerError';
  }
}

export interface ScheduleResult {
  postId: string;
  accountId: string;
  handle: string;
  scheduledAt: Date;
  delayMs: number;
  jobId: string;
}

/**
 * 승인된 Post를 계정 스케줄에 맞춰 발행 큐에 등록.
 */
export async function scheduleApprovedPost(postId: string): Promise<ScheduleResult> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { account: true },
  });
  if (!post) throw new SchedulerError(`Post ${postId} not found`, 'POST_NOT_FOUND');
  if (post.state !== 'APPROVED') {
    throw new SchedulerError(
      `Post ${postId} state=${post.state}, expected APPROVED`,
      'POST_INVALID_STATE',
    );
  }
  const allowInactive = Boolean((post.sourceBrief as { allowInactive?: boolean } | null)?.allowInactive);
  if (!post.account.isActive && !allowInactive) {
    throw new SchedulerError(`Account ${post.account.handle} inactive`, 'ACCOUNT_INACTIVE');
  }

  const now = new Date();

  // 오늘 이 계정의 발행 카운트 (today in account's timezone) — 간단화 위해 UTC 기준
  const todayStart = startOfToday();
  const todayCount = await prisma.post.count({
    where: {
      accountId: post.accountId,
      state: 'PUBLISHED',
      publishedAt: { gte: todayStart },
    },
  });
  if (todayCount >= 1) {
    // 오늘 이미 발행함 → 내일 활성 시간대 시작으로 스케줄
    logger.info(
      { accountId: post.accountId, todayCount },
      'today already published, scheduling for tomorrow',
    );
  }

  // 최근 스케줄된 (미발행) + 발행된 마지막 시각 조회
  const lastActivity = await prisma.post.findFirst({
    where: {
      accountId: post.accountId,
      OR: [
        { state: 'PUBLISHED', publishedAt: { not: null } },
        { state: { in: ['APPROVED', 'PUBLISHING'] }, scheduledAt: { not: null } },
      ],
    },
    orderBy: [{ publishedAt: 'desc' }, { scheduledAt: 'desc' }],
    select: { publishedAt: true, scheduledAt: true },
  });
  const lastTime =
    lastActivity?.publishedAt ??
    lastActivity?.scheduledAt ??
    new Date(0);

  const targetTime = computeNextSlot({
    now,
    lastTime,
    account: {
      activeHourStart: post.account.activeHourStart,
      activeHourEnd: post.account.activeHourEnd,
    },
    todayAlreadyPublished: todayCount >= 1,
  });

  const delayMs = Math.max(0, targetTime.getTime() - now.getTime());

  await prisma.post.update({
    where: { id: postId },
    data: { scheduledAt: targetTime },
  });

  const jobId = `publish-${postId}`;
  await publishQueue.add(
    'publish',
    { postId },
    { delay: delayMs, jobId },
  );

  logger.info(
    {
      postId,
      accountId: post.accountId,
      handle: post.account.handle,
      scheduledAt: targetTime.toISOString(),
      delayMinutes: Math.round(delayMs / 60000),
    },
    'post scheduled',
  );

  return {
    postId,
    accountId: post.accountId,
    handle: post.account.handle,
    scheduledAt: targetTime,
    delayMs,
    jobId,
  };
}

/**
 * 다음 발행 슬롯 계산.
 * - 마지막 활동 + 랜덤 시차(MIN~MAX 분)를 후보로 삼음
 * - 계정 활성 시간대 밖이면 다음 활성 시간대 시작으로 이동
 * - 오늘 이미 발행했으면 무조건 내일 활성 시간대 시작 + 랜덤 오프셋
 */
function computeNextSlot(input: {
  now: Date;
  lastTime: Date;
  account: { activeHourStart: number; activeHourEnd: number };
  todayAlreadyPublished: boolean;
}): Date {
  const { now, lastTime, account, todayAlreadyPublished } = input;
  const randomGap = MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS));

  let candidate: Date;
  if (todayAlreadyPublished) {
    // 내일 활성 시간대 시작 + 0~2시간 랜덤 지터
    candidate = new Date(now);
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(account.activeHourStart, 0, 0, 0);
    candidate = new Date(candidate.getTime() + Math.floor(Math.random() * 2 * 60 * 60 * 1000));
  } else {
    candidate = new Date(Math.max(now.getTime(), lastTime.getTime() + randomGap));
  }

  return clampToActiveHours(candidate, account);
}

function clampToActiveHours(
  time: Date,
  account: { activeHourStart: number; activeHourEnd: number },
): Date {
  const hour = time.getHours();
  const result = new Date(time);
  if (hour < account.activeHourStart) {
    result.setHours(account.activeHourStart, Math.floor(Math.random() * 30), 0, 0);
  } else if (hour >= account.activeHourEnd) {
    // 오늘 시간대 지남 → 내일 시작 시각
    result.setDate(result.getDate() + 1);
    result.setHours(account.activeHourStart, Math.floor(Math.random() * 30), 0, 0);
  }
  return result;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// 계정당 발행 페이싱 규칙 (2026-09-18 사용자 방침):
//   · 종류별 하루 상한: 일상 2건(2026-09-30) · 스하리 1건 · 쇼핑 전체 1건
//   · 같은 계정 글끼리 최소 4시간 간격
const MANUAL_MIN_GAP_MS = 4 * 60 * 60 * 1000;
/** 일상글 계정당 하루 상한 (2026-09-30 1→2). 4h 간격은 유지 → 계정당 하루 최대 ~4건(일상2·스하리1·쇼핑). */
const DAILY_PER_ACCOUNT_CAP = 2;

export interface ManualSchedule {
  targetTime: Date;
  delayMs: number;
  reason: string; // 지연 사유 (즉시면 '')
}

function fmtHm(d: Date): string {
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return hm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/**
 * 수동 승인 발행 시각 계산 — 계정당 페이싱 규칙 적용.
 *   위반 없으면 즉시(delay 0). 위반 시 다음 유효 시각으로 지연.
 */
export async function computeManualPublishSchedule(accountId: string, kind: string): Promise<ManualSchedule> {
  const now = new Date();
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { activeHourStart: true } });

  const activeStart = account?.activeHourStart ?? 9;
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  // 1) 이 계정 마지막 발행/예약 시각 (종류 무관) → 4시간 간격의 기준.
  //    이미 예약된(APPROVED/PUBLISHING) 카드도 포함 → 여러 카드가 4h씩 줄서서 쌓임.
  const last = await prisma.post.findFirst({
    where: {
      accountId,
      OR: [
        { state: 'PUBLISHED', publishedAt: { not: null } },
        { state: { in: ['APPROVED', 'PUBLISHING'] }, scheduledAt: { not: null } },
      ],
    },
    orderBy: [{ publishedAt: 'desc' }, { scheduledAt: 'desc' }],
    select: { publishedAt: true, scheduledAt: true },
  });
  const lastTime = last?.publishedAt ?? last?.scheduledAt ?? new Date(0);

  // 4시간 간격 적용
  let target = new Date(Math.max(now.getTime(), lastTime.getTime() + MANUAL_MIN_GAP_MS));
  let reason = target.getTime() > now.getTime() + 60_000 ? `직전 발행 4h 미달 → ${fmtHm(target)} 예약` : '';

  // 2) 같은 종류가 이미 차지한 '날'은 건너뛴다.
  //    · 쇼핑(SHOPPING): 도달 우선 전략(2026-09-22) → **전체 계정 합산 하루 1건**만.
  //    · 일상(DAILY): 계정당 하루 2건 · 스하리(SHARING): 계정당 하루 1건.
  //    발행됨 + 예약됨 모두 카운트 → 같은 종류 카드를 연달아 승인해도 하루 하나씩 다음날로 밀림.
  const shoppingGlobalCap = kind === 'SHOPPING'; // 쇼핑은 계정 무관 글로벌 캡
  const sameKind = await prisma.post.findMany({
    where: {
      ...(shoppingGlobalCap ? {} : { accountId }),
      kind: kind as never,
      OR: [
        { state: 'PUBLISHED', publishedAt: { not: null } },
        { state: { in: ['APPROVED', 'PUBLISHING'] }, scheduledAt: { not: null } },
      ],
    },
    select: { publishedAt: true, scheduledAt: true },
  });
  // 일상글은 계정당 하루 2건 (2026-09-30 사용자 "일상글을 많이 발행해야" · 링크 없는 도달 엔진). 나머지 1건.
  const perDayCap = kind === 'DAILY' ? DAILY_PER_ACCOUNT_CAP : 1;
  const dayCount = new Map<string, number>();
  for (const p of sameKind) {
    const k = dayKey((p.publishedAt ?? p.scheduledAt)!);
    dayCount.set(k, (dayCount.get(k) ?? 0) + 1);
  }
  const usedDays = new Set([...dayCount].filter(([, n]) => n >= perDayCap).map(([k]) => k));
  while (usedDays.has(dayKey(target))) {
    const next = new Date(target);
    next.setDate(next.getDate() + 1);
    next.setHours(activeStart, Math.floor(Math.random() * 30), 0, 0);
    target = next;
    reason = shoppingGlobalCap
      ? `쇼핑 전체 하루 1건 → 다른 날 예약 ${fmtHm(target)}`
      : `${kind} 다른 날 예약(계정당 하루 ${perDayCap}건) → ${fmtHm(target)}`;
  }

  return { targetTime: target, delayMs: Math.max(0, target.getTime() - now.getTime()), reason };
}

/**
 * 계정별 예정된 발행 스케줄 조회 (Admin UI · 관찰용).
 */
export async function getSchedulesByAccount() {
  const scheduled = await prisma.post.findMany({
    where: {
      state: 'APPROVED',
      scheduledAt: { not: null, gte: new Date() },
    },
    include: { account: { select: { handle: true } } },
    orderBy: { scheduledAt: 'asc' },
  });
  return scheduled.map((p) => ({
    postId: p.id,
    accountId: p.accountId,
    handle: p.account.handle,
    scheduledAt: p.scheduledAt,
    body: p.generatedBody?.slice(0, 80) ?? '',
  }));
}
