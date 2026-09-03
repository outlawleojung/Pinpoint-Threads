import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { runPipelineA } from '../orchestrator.js';
import { ContentType, PostKind, PostState } from '@prisma/client';
/**
 * Pipeline A 쇼핑 발행 오케스트레이터 (자동 크론).
 *
 * 계정별 발행 시각은 승인 시점의 scheduleApprovedPost 가 계정 시차·활성 시간대 반영해 배정.
 * 이 오케스트레이터는 승인 카드 생성까지만 담당 (자동 승인 X).
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
    select: { id: true, handle: true, isActive: true, audienceGender: true },
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
  // 하이브리드 + 자동 매칭 모두 후보. 승인 카드에서 사용자님이 매칭 확인 후 승인/리젝.
  const candidates = await prisma.benchmarkPost.findMany({
    where: {
      contentType: ContentType.SHOPPING,
      collectedAt: { gte: lookbackDate },
      mediaUrls: { isEmpty: false },
      id: { notIn: Array.from(recentBenchmarkIdsUsed) },
    },
    orderBy: [{ likesCount: 'desc' }, { collectedAt: 'desc' }],
    take: slotsLeft * 6,
    select: {
      id: true,
      permalink: true,
      text: true,
      mediaUrls: true,
      inboundLinkId: true,
      likesCount: true,
      viralFactors: true,
    },
  });

  if (candidates.length === 0) {
    return [{ status: 'skipped_no_candidate', reason: `SHOPPING 벤치마크 후보 없음 (14일 재사용 제외 · 30일 수집만)` }];
  }

  // 계정 시차 시각 배정 (자동 발행 스케줄)
  const results: ShoppingPublishResult[] = [];
  let picked = 0;
  for (const b of candidates) {
    if (picked >= slotsLeft) break;
    if (b.mediaUrls.length < 2) continue;

    // 성별 매칭 필터: 계정 audienceGender 와 벤치마크 audience(viralFactors.audience) 충돌 시 skip
    // - male 계정 ↔ female 상품 X
    // - female 계정 ↔ male 상품 X
    // - unisex 는 모두 허용
    const benchAudience = (b as any).viralFactors?.audience as 'male' | 'female' | 'unisex' | undefined;
    if (
      benchAudience &&
      benchAudience !== 'unisex' &&
      account.audienceGender !== 'unisex' &&
      benchAudience !== account.audienceGender
    ) {
      logger.info(
        { accountId: account.id, accGender: account.audienceGender, benchAudience, benchmarkPostId: b.id },
        'shopping candidate skipped: gender mismatch',
      );
      continue;
    }

    try {
      const inboundLink = b.inboundLinkId
        ? await prisma.inboundLink.findUnique({
            where: { id: b.inboundLinkId },
            select: { manualCommerceUrl: true },
          })
        : null;

      // Threads 벤치마크에 mp4 없으면 Playwright 재확인 (어댑터가 media_type 힌트 못 잡은 케이스 구제)
      let effectiveMedia = b.mediaUrls;
      const isThreads = b.permalink?.includes('threads.') ?? false;
      const hasMp4 = b.mediaUrls.some((u) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/'));
      if (isThreads && !hasMp4 && b.permalink) {
        try {
          const { extractThreadsVideoUrls, pickBestMp4s } = await import('../../../infra/playwright-threads-video.js');
          const { mp4Urls } = await extractThreadsVideoUrls(b.permalink);
          const bestMp4s = pickBestMp4s(mp4Urls); // 최대 1개
          if (bestMp4s.length > 0) {
            // 원본 이미지 URL 은 그대로 유지 · 앞에 mp4 1개 붙임 (원본 손실 X · 총 슬롯 max 10).
            effectiveMedia = [bestMp4s[0]!, ...b.mediaUrls].slice(0, 10);
            await prisma.benchmarkPost.update({
              where: { id: b.id },
              data: { mediaUrls: effectiveMedia },
            }).catch(() => {});
            logger.info({ benchmarkId: b.id, before: b.mediaUrls.length, after: effectiveMedia.length }, 'playwright rescue: 1 mp4 prepended');
          }
        } catch (err) {
          logger.warn({ err, benchmarkId: b.id }, 'playwright rescue failed · proceeding with image-only');
        }
      }

      const outcome = await runPipelineA({
        accountId: account.id,
        sourceMediaUrls: effectiveMedia,
        sourceText: b.text,
        sourceUrl: b.permalink,
        explicitCommerceUrl: inboundLink?.manualCommerceUrl ?? undefined,
      });

      if (outcome.status === 'PENDING_APPROVAL') {
        // 승인 카드 모드: runPipelineA 가 이미 승인 카드 전송 · PENDING_APPROVAL 상태.
        // 자동 승인 안 함 (사용자님이 텔레그램에서 승인/리젝) — 승인 시 scheduleApprovedPost 가 시각 배정.
        results.push({
          status: 'sent_for_approval',
          postId: outcome.postId,
          benchmarkPostId: b.id,
          body: outcome.body,
          reason: '승인 대기 (텔레그램 승인/리젝)',
        });
        picked += 1;
        logger.info(
          { postId: outcome.postId, handle: account.handle },
          'shopping post sent for approval (waiting user)',
        );
      } else {
        // 매칭 실패 (vision-failed / no-candidate 등) → 사용자님에게 URL 답장 대기 카드 발송
        if (outcome.stage === 'matcher') {
          const { sendMatchWaitingCard } = await import('../../shared/approval-gate/pending-match.js');
          await sendMatchWaitingCard({
            benchmarkPostId: b.id,
            accountId: account.id,
            accountHandle: account.handle,
            benchmarkText: b.text,
            benchmarkPermalink: b.permalink,
            benchmarkMediaUrls: b.mediaUrls,
          });
        }
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
  // 계정별 14일 이내 발행/승인된 벤치마크만 제외 (재발 방지 블랙리스트는 폐기 —
  // 매칭 실패는 새 대기 카드 흐름으로 사용자님이 URL 답장으로 구제하므로 제외 불필요).
  const posts = await prisma.post.findMany({
    where: {
      accountId,
      kind: PostKind.SHOPPING,
      createdAt: { gte: since },
      state: { notIn: [PostState.REJECTED, PostState.FAILED] },
    },
    select: { sourceItem: { select: { sourceUrl: true } } },
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
