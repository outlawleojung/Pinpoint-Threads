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
/** 계정 간 최소 시차 30분 + 랜덤 0~30분 (2026-10-01 사용자 결정: 1~2h는 너무 느림 → 30분~1h). */
const CROSS_ACCOUNT_MIN_GAP_MS = 30 * 60 * 1000;
const CROSS_ACCOUNT_JITTER_MS = 30 * 60 * 1000;
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

/** 종류별 발행 시간창 (KST 시·분). 스하리 = 아침 첫 글, 일상·쇼핑 = 스하리 4h 뒤부터 (2026-10-12 사용자 "스하리는 아침에"). */
const KIND_WINDOW: Record<string, { start: [number, number]; end: [number, number] }> = {
  SHARING: { start: [8, 0], end: [10, 30] }, // 3계정 × 계정 간 30분~1h 시차가 들어가게 (10/15 sookck 다음 날로 밀림)
  DAILY: { start: [13, 0], end: [22, 30] },
  SHOPPING: { start: [13, 0], end: [22, 30] },
};
const SEARCH_DAYS = 14;

/**
 * 수동 승인 발행 시각 계산 — 아래를 **모두** 만족하는 가장 이른 시각 (2026-10-12 재작성):
 *   ① 종류별 시간창(스하리 08:00~10:30 · 일상/쇼핑 13:00~22:30)
 *   ② 같은 계정의 발행·예약 글과 **앞뒤 모두** 4h 이상 (과거 글만 보던 방식 → 아침 스하리를 끼워 넣을 수 있게)
 *   ③ 종류별 하루 상한(일상 계정당 2 · 스하리 1 · 쇼핑 전체 1)
 *   ④ 다른 계정 글과 30분 + 0~30분 랜덤 시차
 */
export async function computeManualPublishSchedule(
  accountId: string,
  kind: string,
  opts: { excludePostId?: string } = {},
): Promise<ManualSchedule> {
  const now = new Date();
  const win = KIND_WINDOW[kind] ?? KIND_WINDOW.DAILY!;
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const live = {
    OR: [
      { state: 'PUBLISHED' as const, publishedAt: { gte: new Date(now.getTime() - 2 * 864e5) } },
      { state: { in: ['APPROVED', 'PUBLISHING'] as ('APPROVED' | 'PUBLISHING')[] }, scheduledAt: { not: null } },
    ],
    ...(opts.excludePostId ? { id: { not: opts.excludePostId } } : {}),
  };
  const rows = await prisma.post.findMany({
    where: live,
    select: { accountId: true, kind: true, publishedAt: true, scheduledAt: true },
  });
  const at = (p: (typeof rows)[number]) => (p.publishedAt ?? p.scheduledAt)!.getTime();
  const own = rows.filter((p) => p.accountId === accountId).map(at);
  const others = rows.filter((p) => p.accountId !== accountId).map(at);
  const shoppingGlobalCap = kind === 'SHOPPING';
  const perDayCap = kind === 'DAILY' ? DAILY_PER_ACCOUNT_CAP : 1;
  const dayCount = new Map<string, number>();
  for (const p of rows) {
    if (p.kind !== kind || (!shoppingGlobalCap && p.accountId !== accountId)) continue;
    const k = dayKey(new Date(at(p)));
    dayCount.set(k, (dayCount.get(k) ?? 0) + 1);
  }
  const crossGapMs = CROSS_ACCOUNT_MIN_GAP_MS + Math.floor(Math.random() * CROSS_ACCOUNT_JITTER_MS);
  const jitterMs = Math.floor(Math.random() * 20) * 60_000; // 창 시작 시각 랜덤(매일 같은 분 X)

  const windowOf = (d: Date) => {
    const s = new Date(d); s.setHours(win.start[0], win.start[1], 0, 0);
    const e = new Date(d); e.setHours(win.end[0], win.end[1], 0, 0);
    return { s: s.getTime(), e: e.getTime() };
  };
  const nextDayStart = (t: number) => {
    const d = new Date(t); d.setDate(d.getDate() + 1);
    return windowOf(d).s + jitterMs;
  };

  let t = now.getTime();
  const limit = now.getTime() + SEARCH_DAYS * 864e5;
  for (let guard = 0; guard < 5000 && t < limit; guard++) {
    const w = windowOf(new Date(t));
    if (t < w.s) { t = w.s + jitterMs; continue; }
    if (t > w.e) { t = nextDayStart(t); continue; }
    if ((dayCount.get(dayKey(new Date(t))) ?? 0) >= perDayCap) { t = nextDayStart(t); continue; }
    const ownClash = own.find((x) => Math.abs(t - x) < MANUAL_MIN_GAP_MS);
    if (ownClash != null) { t = ownClash + MANUAL_MIN_GAP_MS; continue; }
    const otherClash = others.find((x) => Math.abs(t - x) < crossGapMs);
    if (otherClash != null) { t = otherClash + crossGapMs; continue; }
    const target = new Date(t);
    const reason = t - now.getTime() > 60_000 ? `${kind} 예약 ${target.getMonth() + 1}/${target.getDate()} ${fmtHm(target)}` : '';
    return { targetTime: target, delayMs: Math.max(0, t - now.getTime()), reason };
  }
  throw new Error(`${SEARCH_DAYS}일 안에 ${kind} 발행 가능한 시각 없음`);
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

/**
 * 스하리 연속 금지 (2026-10-04 사용자 결정): 계정의 **직전 글이 스하리면 다음 스하리 X** — 사이에 일상글(또는 쇼핑)이 있어야 함.
 *   includeQueued=true(승인·계획 단계): 이미 예약된(APPROVED/PUBLISHING) 글까지 "직전"으로 본다.
 *   includeQueued=false(발행 직전): 실제 나간 글(PUBLISHED/PUBLISHING)만.
 * 위반이면 사유 문자열, 아니면 null.
 */
export async function consecutiveSharingBlock(
  accountId: string,
  opts: { excludePostId?: string; includeQueued: boolean; at?: Date },
): Promise<string | null> {
  const states = opts.includeQueued ? (['PUBLISHED', 'PUBLISHING', 'APPROVED'] as const) : (['PUBLISHED', 'PUBLISHING'] as const);
  const rows = await prisma.post.findMany({
    where: {
      accountId,
      state: { in: [...states] },
      ...(opts.excludePostId ? { id: { not: opts.excludePostId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { kind: true, publishedAt: true, scheduledAt: true, createdAt: true },
  });
  const t = (p: (typeof rows)[number]) => (p.publishedAt ?? p.scheduledAt ?? p.createdAt).getTime();
  // at 이 주어지면 그 시각 **직전** 글 기준 (아침 스하리를 다음 날로 예약할 때 · 2026-10-12)
  const last = rows.filter((p) => !opts.at || t(p) < opts.at.getTime()).sort((a, b) => t(b) - t(a))[0];
  if (!last || last.kind !== 'SHARING') return null;
  const when = new Date(t(last)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return `직전 글(${when})이 스하리 → 스하리 연속 금지 · 일상글 먼저`;
}
