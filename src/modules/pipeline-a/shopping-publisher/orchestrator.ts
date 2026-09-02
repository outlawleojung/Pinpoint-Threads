import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { runPipelineA } from '../orchestrator.js';
import { ContentType, PostKind, PostState } from '@prisma/client';
import { publishQueue } from '../../../queues/queues.js';

/**
 * 자동 발행 시각 배정 · 계정별 · 하루 2회 · CIB 회피 시차.
 *   시각 배정 규칙 (KST):
 *     · 계정 index 0: 10:00, 17:00
 *     · 계정 index 1: 11:30, 18:30
 *     · 계정 index 2: 13:00, 20:00
 *     · 계정 index 3: 14:30, 21:30
 *     · 계정 index 4: 16:00, 22:30
 *   · 계정 4개 이상이어도 겹치지 않게 90분 간격 rotation.
 */
function assignScheduledTimes(accountIndex: number, count: number): Date[] {
  const now = new Date();
  const kstBaseHour = 10; // 첫 계정 첫 slot = 10시 KST
  const perAccountOffsetMin = 90; // 계정 간 90분
  const perSlotHour = 7; // 같은 계정 slot 간 7시간
  const results: Date[] = [];
  for (let i = 0; i < count; i++) {
    const totalMin = kstBaseHour * 60 + accountIndex * perAccountOffsetMin + i * perSlotHour * 60;
    // KST 오늘 자정 (UTC로 어제 15:00) 기준
    const kstMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), -9, 0, 0));
    // 오늘 KST 00:00 → UTC 로는 어제 15:00
    const t = new Date(kstMidnightUTC.getTime() + totalMin * 60 * 1000);
    // 이미 지난 시각이면 내일로 밀기
    if (t.getTime() < Date.now()) {
      t.setTime(t.getTime() + 24 * 60 * 60 * 1000);
    }
    results.push(t);
  }
  return results;
}

/**
 * Pipeline A 쇼핑 발행 오케스트레이터 (자동 크론).
 *
 * 흐름:
 *   1) 활성 계정 순회
 *   2) 계정별 SHOPPING 벤치마크 후보 조회
 *      - contentType=SHOPPING, publishedAt 최근 (또는 collectedAt)
 *      - 최근 14일 내 같은 벤치마크 다른 계정에 발행됨 → 제외
 *      - 같은 계정 24h 내 SHOPPING 발행 count · 하드 캡 (2건/일)
 *   3) 상위 1~2개 벤치마크 선정
 *   4) 각 벤치마크에 대해 Pipeline A 실행 → PENDING_APPROVAL 승인 카드
 *   5) 사용자 승인 → 기존 publisher 발행
 */

const PER_ACCOUNT_DAILY_MAX = 2; // 계정당 하루 최대 쇼핑 발행 (사용자 방침)
const BENCHMARK_LOOKBACK_DAYS = 30; // 최근 30일 이내 수집된 벤치마크만 후보
const DUPLICATE_LOOKBACK_DAYS = 14; // 같은 벤치마크 최근 14일 내 다른 계정 발행 여부

export interface ShoppingPublishInput {
  accountId: string;
  accountIndex?: number; // 계정 간 시차 배정용 (0..4)
  maxNewPosts?: number; // 이 실행에서 만들 최대 카드 수 (계정당)
}

export interface ShoppingPublishResult {
  status: 'sent_for_approval' | 'skipped_daily_cap' | 'skipped_no_candidate' | 'failed';
  postId?: string;
  benchmarkPostId?: string;
  body?: string;
  reason?: string;
}

export async function runShoppingForAccount(
  input: ShoppingPublishInput,
): Promise<ShoppingPublishResult[]> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { id: true, handle: true, isActive: true },
  });
  if (!account.isActive) {
    return [{ status: 'failed', reason: 'account inactive' }];
  }

  const maxNew = Math.min(input.maxNewPosts ?? PER_ACCOUNT_DAILY_MAX, PER_ACCOUNT_DAILY_MAX);

  // 오늘 계정에 이미 만들어진 SHOPPING PENDING/APPROVED/PUBLISHED count
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = await prisma.post.count({
    where: {
      accountId: account.id,
      kind: PostKind.SHOPPING,
      createdAt: { gte: todayStart },
      state: { notIn: [PostState.REJECTED, PostState.FAILED] },
    },
  });
  const slotsLeft = maxNew - todayCount;
  if (slotsLeft <= 0) {
    return [{ status: 'skipped_daily_cap', reason: `이미 오늘 ${todayCount}건 (cap=${maxNew})` }];
  }

  // 최근 duplicateLookback 내 이 계정에 이미 사용된 benchmarkPostId (via inboundLinkId 또는 sourceItemId)
  const recentBenchmarkIdsUsed = await getRecentlyUsedBenchmarkIds(account.id, DUPLICATE_LOOKBACK_DAYS);

  const lookbackDate = new Date(Date.now() - BENCHMARK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.benchmarkPost.findMany({
    where: {
      contentType: ContentType.SHOPPING,
      collectedAt: { gte: lookbackDate },
      mediaUrls: { isEmpty: false }, // 미디어 없는 벤치마크 제외
      id: { notIn: Array.from(recentBenchmarkIdsUsed) },
    },
    orderBy: [{ likesCount: 'desc' }, { collectedAt: 'desc' }],
    take: slotsLeft * 3, // 여유 3배 잡고 실패해도 대체
    select: {
      id: true,
      permalink: true,
      text: true,
      mediaUrls: true,
      inboundLinkId: true,
      likesCount: true,
    },
  });

  if (candidates.length === 0) {
    return [{ status: 'skipped_no_candidate', reason: `SHOPPING 벤치마크 후보 없음 (14일 재사용 제외 · 30일 수집만)` }];
  }

  // 계정 시차 시각 배정 (자동 발행 스케줄)
  const scheduledTimes = assignScheduledTimes(input.accountIndex ?? 0, slotsLeft);

  const results: ShoppingPublishResult[] = [];
  let picked = 0;
  for (const b of candidates) {
    if (picked >= slotsLeft) break;
    if (b.mediaUrls.length < 2) continue;

    try {
      const inboundLink = b.inboundLinkId
        ? await prisma.inboundLink.findUnique({
            where: { id: b.inboundLinkId },
            select: { manualCommerceUrl: true },
          })
        : null;

      const outcome = await runPipelineA({
        accountId: account.id,
        sourceMediaUrls: b.mediaUrls,
        sourceText: b.text,
        sourceUrl: b.permalink,
        explicitCommerceUrl: inboundLink?.manualCommerceUrl ?? undefined,
      });

      if (outcome.status === 'PENDING_APPROVAL') {
        // 자동 발행 모드: 승인 카드 스킵 · 즉시 APPROVED + scheduledAt + publishQueue delay 잡 추가
        const scheduledAt = scheduledTimes[picked]!;
        await prisma.post.update({
          where: { id: outcome.postId },
          data: {
            state: PostState.APPROVED,
            approvedAt: new Date(),
            scheduledAt,
          },
        });
        const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
        await publishQueue.add(
          'publish',
          { postId: outcome.postId },
          { delay: delayMs, jobId: `publish-${outcome.postId}` },
        );
        results.push({
          status: 'sent_for_approval',
          postId: outcome.postId,
          benchmarkPostId: b.id,
          body: outcome.body,
          reason: `scheduledAt=${scheduledAt.toISOString()}`,
        });
        picked += 1;
        logger.info(
          { postId: outcome.postId, handle: account.handle, scheduledAt: scheduledAt.toISOString() },
          'shopping post scheduled (auto-approve)',
        );
      } else {
        results.push({
          status: 'failed',
          benchmarkPostId: b.id,
          reason: `stage=${outcome.stage} · ${outcome.reason}`,
        });
      }
    } catch (err) {
      logger.error({ err, accountId: account.id, benchmarkPostId: b.id }, 'shopping publish failed');
      results.push({
        status: 'failed',
        benchmarkPostId: b.id,
        reason: (err as Error).message,
      });
    }
  }
  return results;
}

/**
 * 최근 N일 이내 이 계정에 발행/승인된 Post 들의 원본 BenchmarkPost id 목록.
 * Post -> SourceItem -> InboundLink -> BenchmarkPost 는 없음. 대신
 * Post.sourceItemId -> SourceItem.sourceUrl -> BenchmarkPost.permalink 로 매칭.
 */
async function getRecentlyUsedBenchmarkIds(accountId: string, days: number): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const posts = await prisma.post.findMany({
    where: {
      accountId,
      kind: PostKind.SHOPPING,
      createdAt: { gte: since },
      state: { notIn: [PostState.REJECTED, PostState.FAILED] },
    },
    select: {
      sourceItem: { select: { sourceUrl: true } },
    },
  });
  const sourceUrls = posts.map((p) => p.sourceItem?.sourceUrl).filter((u): u is string => !!u);
  if (sourceUrls.length === 0) return new Set();
  const benches = await prisma.benchmarkPost.findMany({
    where: { permalink: { in: sourceUrls } },
    select: { id: true },
  });
  return new Set(benches.map((b) => b.id));
}

export interface ShoppingBatchSummary {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  perAccount: Array<{
    handle: string;
    results: ShoppingPublishResult[];
  }>;
}

export async function runShoppingForAllAccounts(): Promise<ShoppingBatchSummary> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, handle: true },
    orderBy: { handle: 'asc' },
  });

  const summary: ShoppingBatchSummary = {
    total: accounts.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    perAccount: [],
  };

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i]!;
    try {
      const results = await runShoppingForAccount({ accountId: acc.id, accountIndex: i });
      summary.perAccount.push({ handle: acc.handle, results });
      for (const r of results) {
        if (r.status === 'sent_for_approval') summary.sent += 1;
        else if (r.status.startsWith('skipped_')) summary.skipped += 1;
        else summary.failed += 1;
      }
    } catch (err) {
      logger.error({ err, accountId: acc.id }, 'shopping batch crashed');
      summary.perAccount.push({
        handle: acc.handle,
        results: [{ status: 'failed', reason: (err as Error).message }],
      });
      summary.failed += 1;
    }
  }

  logger.info({ summary }, 'shopping publish batch done');
  return summary;
}
