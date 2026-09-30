import { Worker } from 'bullmq';
import { redisConnection } from '../queues/connection.js';
import {
  QUEUE_NAMES,
  trendPollQueue,
  trendDigestQueue,
  trendSearchQueue,
  sharingCollectQueue,
  sharingPublishQueue,
  accountMetricsSyncQueue,
  shoppingPublishQueue,
  lineBPublishQueue,
  naverDailyInfoQueue,
  naverTrendCollectQueue,
} from '../queues/queues.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import {
  pollAllAdapters,
  decayOldSignals,
  type TrendSourceAdapter,
} from '../modules/shared/trend-signals/index.js';
import { NaverDatalabAdapter } from '../modules/shared/trend-signals/adapters/naver-datalab.js';
import { GoogleTrendsAdapter } from '../modules/shared/trend-signals/adapters/google-trends.js';
import { CoupangRankingAdapter } from '../modules/shared/trend-signals/adapters/coupang-ranking.js';
import { TikTokCreativeCenterAdapter } from '../modules/shared/trend-signals/adapters/tiktok-creative-center.js';
import { sendDigestMessage } from '../modules/shared/approval-gate/notifier.js';
import { safeRunTrendSearchIngest } from '../modules/shared/trend-signals/search-orchestrator.js';
import { safeCollectSharingBenchmarks } from '../modules/pipeline-b/sharing-collector/index.js';
import { runSharingForAllAccounts } from '../modules/pipeline-b/sharing-publisher/orchestrator.js';
import { syncAllAccountMetrics } from '../modules/pipeline-b/sharing-copywriter/follower-sync.js';
import { runShoppingForAllAccounts } from '../modules/pipeline-a/shopping-publisher/orchestrator.js';
import { runLineBForAccount } from '../modules/pipeline-a/line-b/orchestrator.js';
import { runDailyInfoJob } from '../modules/pipeline-d/daily-info-job/index.js';
import { collectNaverTrends } from '../modules/pipeline-d/trend-collect/index.js';

/**
 * Lane 2 자율 트렌드 워커 · 스케줄러.
 *
 * TREND_POLL — 6시간마다 모든 어댑터 실행 + 오래된 신호 감쇠
 * TREND_DIGEST — 매일 아침 08:00 텔레그램에 상위 시그널 다이제스트
 *
 * BullMQ repeatable job 사용. 앱 재시작해도 스케줄 유지.
 */

const POLL_CRON = '0 7 * * *'; // 매일 07:00 KST (하루 1회. 이전 6h → 하루 1회로 축소)
const DIGEST_CRON = '0 8 * * *'; // 매일 08:00 KST (발굴 후보 카드 푸시 · LLM 없음)
const DISCOVERY_PUSH_LIMIT = 10;
const SEARCH_CRON = '30 8 * * *'; // 매일 08:30 KST (다이제스트 이후)
const SHARING_CRON = '0 8 * * *';  // 매일 08:00 KST (Pipeline B 스하리 벤치마크 수집 · publish 1h 전)
const SHARING_PUBLISH_CRON = '0 9 * * *'; // 매일 09:00 KST (Pipeline B 계정별 스하리 카피 생성 → 승인 카드)
const ACCOUNT_METRICS_CRON = '30 7 * * *'; // 매일 07:30 KST (계정 팔로워·나이 갱신 · publish 1.5h 전)
const SHOPPING_PUBLISH_CRON = '0 9 * * *'; // 매일 09:00 KST (쇼핑 카피 생성 · 발행 slot 은 계정별 시차)
const NAVER_DAILY_INFO_CRON = '0 9 * * *'; // 매일 09:00 KST (Pipeline D 정보글 1건 생성 + 관리자 알림)
const NAVER_TREND_COLLECT_CRON = '50 8 * * *'; // 매일 08:50 KST (Pipeline D 블로그 트렌드 수집, naver-daily-info 09:00 이전)

function buildAdapters(): TrendSourceAdapter[] {
  return [
    new NaverDatalabAdapter(),
    new GoogleTrendsAdapter(),
    new CoupangRankingAdapter(),
    new TikTokCreativeCenterAdapter(),
  ];
}

export function startTrendWorkers(): Worker[] {
  const workers: Worker[] = [];

  workers.push(
    new Worker(
      QUEUE_NAMES.TREND_POLL,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'trend-poll start');
        const adapters = buildAdapters();
        const summary = await pollAllAdapters(adapters);
        const decayed = await decayOldSignals(14);
        logger.info(
          { summary, decayed, jobId: job.id },
          'trend-poll done',
        );
        return { summary, decayed };
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.TREND_DIGEST,
      async (job) => {
        // 2026-09-30: LLM 트렌드 주제(엉뚱해서 폐기) → **해외 스레드 발굴 후보 카드**로 교체. LLM 0원.
        //   카드의 [🌿 일상글]/[🛍 쇼핑글]을 누를 때만 카피 LLM 호출.
        const limit = job.data.limit ?? DISCOVERY_PUSH_LIMIT;
        logger.info({ jobId: job.id, limit }, 'discovery-push start');
        const { discoverCandidates } = await import('../modules/shared/discovery/index.js');
        const { sendDiscoveryCards } = await import('../modules/shared/approval-gate/notifier.js');
        const { candidates, degraded } = await discoverCandidates({ limit });
        if (candidates.length === 0) {
          await sendDigestMessage(
            '🌅 오늘의 소재: 새 후보 없음' + (degraded.length ? `
(${degraded.map((d) => d.reason).join(' / ')})` : ''),
          );
          return { sent: 0 };
        }
        const nDaily = candidates.filter((c) => c.kindHint === 'daily').length;
        await sendDiscoveryCards(
          candidates,
          `🌅 오늘의 소재 ${candidates.length}건 (일상 ${nDaily} · 쇼핑 ${candidates.length - nDaily})
해외 스레드에서 댓글 반응 있는 것만. 버튼 누르면 승인 카드가 올라옵니다. (24h 만료)`,
        );
        return { sent: candidates.length };
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.TREND_SEARCH,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'trend-search start');
        const summary = await safeRunTrendSearchIngest({
          topSignals: job.data.topSignals ?? 5,
          perPlatformResults: job.data.perPlatformResults ?? 10,
          minLikes: job.data.minLikes ?? 100,
        });
        logger.info({ jobId: job.id, summary }, 'trend-search done');
        return summary ?? { skipped: true };
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.SHARING_COLLECT,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'sharing-collect start');
        const summary = await safeCollectSharingBenchmarks();
        logger.info({ jobId: job.id, summary }, 'sharing-collect done');
        return summary ?? { skipped: true };
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.SHARING_PUBLISH,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'sharing-publish start');
        const summary = await runSharingForAllAccounts();
        logger.info({ jobId: job.id, summary }, 'sharing-publish done');
        return summary;
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.ACCOUNT_METRICS_SYNC,
      async (job) => {
        logger.info({ jobId: job.id }, 'account-metrics-sync start');
        const results = await syncAllAccountMetrics();
        logger.info({ jobId: job.id, results }, 'account-metrics-sync done');
        return { results };
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.SHOPPING_PUBLISH,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'shopping-publish start');
        const summary = await runShoppingForAllAccounts();
        logger.info({ jobId: job.id, summary }, 'shopping-publish done');
        return summary;
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  // Line B (상품 우선) — 계정별 잡. 계정마다 다른 시각에 1건씩 (스태거).
  workers.push(
    new Worker(
      QUEUE_NAMES.LINE_B_PUBLISH,
      async (job) => {
        const { accountId } = job.data;
        logger.info({ jobId: job.id, accountId }, 'line-b-publish start');
        const result = await runLineBForAccount(accountId);
        logger.info({ jobId: job.id, accountId, result }, 'line-b-publish done');
        return result;
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.NAVER_DAILY_INFO,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'naver-daily-info start');
        const result = await runDailyInfoJob();
        logger.info({ jobId: job.id, result }, 'naver-daily-info done');
        return result;
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.NAVER_TREND_COLLECT,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'naver-trend-collect start');
        const result = await collectNaverTrends();
        logger.info({ jobId: job.id, result }, 'naver-trend-collect done');
        return result;
      },
      { connection: redisConnection, concurrency: 1 },
    ),
  );

  logger.info(
    'Started 10 trend workers (trend-poll · trend-digest · trend-search · sharing-collect · sharing-publish · account-metrics-sync · shopping-publish · line-b-publish · naver-daily-info · naver-trend-collect)',
  );
  return workers;
}

// Line B 계정별 발행 시각 (KST). 5계정을 하루에 걸쳐 분산 · 1~4h 시차 (CLAUDE.md 안전 방침).
// 불규칙한 분(minute)으로 봇 티 최소화. 계정 수 > 슬롯이면 순환.
const LINE_B_SLOTS = ['20 10 * * *', '10 13 * * *', '40 15 * * *', '20 18 * * *', '10 21 * * *'];

export async function scheduleTrendJobs(): Promise<void> {
  // ⛔ 트렌드 폴 **정지** (2026-09-18 · 불필요 API 정리). 자동 트렌드 수집은 수동 URL 흐름에 안 쓰이고
  //   다운스트림 검색·태깅 LLM 호출을 유발. 재활성: 아래 removeRepeatable → add 로 되돌리면 됨.
  await trendPollQueue
    .removeRepeatable('trend-poll-daily', { pattern: POLL_CRON, tz: 'Asia/Seoul' }, 'trend-poll-daily')
    .catch(() => {});

  // ⛔ 아침 발굴 카드 푸시 **정지** (2026-09-30 사용자: 자동으로 가져온 소재 품질 불가 — "한숨만 나온다").
  //   소재 선정은 사람(사용자 URL). 자동 발굴은 buzzweet·스레드 검색 두 번 다 실패. 재가동 금지(사용자 요청 전까지).
  await trendDigestQueue
    .removeRepeatable('trend-digest-daily', { pattern: DIGEST_CRON, tz: 'Asia/Seoul' }, 'trend-digest-daily')
    .catch(() => {});

  // ⛔ 트렌드 검색+자동 인제스트 **정지** (2026-09-18 · 불필요 API 정리).
  //   검색→후보 자동수집→LLM 태깅/분류(search-orchestrator·filter·viralfactors-tagger·content-classifier)로
  //   토큰을 크게 소모. 소스는 수동 URL만 사용하므로 불필요.
  await trendSearchQueue
    .removeRepeatable('trend-search-daily', { pattern: SEARCH_CRON, tz: 'Asia/Seoul' }, 'trend-search-daily')
    .catch(() => {});

  // ✅ 스하리 벤치마크 수집 **유지** (스하리 상대 발견에 필요 · 스크래핑은 Apify라 Anthropic 크레딧 안 씀).
  //   단 수집된 글의 viralfactors LLM 태깅은 비용 절감 위해 끔(sharing-collector VIRALFACTORS_TAG_ENABLED=false).
  await sharingCollectQueue.add(
    'sharing-collect-daily',
    { triggeredBy: 'scheduler' },
    {
      repeat: { pattern: SHARING_CRON, tz: 'Asia/Seoul' },
      jobId: 'sharing-collect-daily',
    },
  );

  // daily 계정 metrics (팔로워·나이) 갱신 (publish 전 필수)
  await accountMetricsSyncQueue.add(
    'account-metrics-sync-daily',
    { triggeredBy: 'scheduler' },
    {
      repeat: { pattern: ACCOUNT_METRICS_CRON, tz: 'Asia/Seoul' },
      jobId: 'account-metrics-sync-daily',
    },
  );

  // ⛔ 스하리 자동 카피 생성 **정지** (2026-09-18 · 불필요 API 정리).
  //   계정별 매일 LLM 카피 생성 = 사람 트리거 없는 백그라운드 토큰 소모. 스하리도 수동 발행으로 전환.
  await sharingPublishQueue
    .removeRepeatable('sharing-publish-daily', { pattern: SHARING_PUBLISH_CRON, tz: 'Asia/Seoul' }, 'sharing-publish-daily')
    .catch(() => {});

  // ⛔ 자동 쇼핑 발행 크론 **정지** (2026-09-04 사용자 방침).
  //   이유: 좋아요순 top 벤치마크를 5계정에 동시·동일 콘텐츠로 뿌려 "매일 각 계정 똑같은 쇼핑글" 발생.
  //   대체: 수동 URL+상품명 흐름만 사용. 향후 "한 계정 발행 → 반응 좋으면 타 계정 확산"(성과 게이팅) 별도 구현 예정.
  //   기존에 등록된 repeatable job 은 removeRepeatable 로 제거 필요 (scripts 참고).
  // await shoppingPublishQueue.add('shopping-publish-daily', ...);
  await shoppingPublishQueue
    .removeRepeatable('shopping-publish-daily', { pattern: SHOPPING_PUBLISH_CRON, tz: 'Asia/Seoul' }, 'shopping-publish-daily')
    .catch(() => {});

  // Line B (상품 우선) 계정별 스태거 크론 — 각 계정 하루 1건, 서로 다른 시각.
  //   같은 상품 금지(크로스계정 DB dedup) · 동시 발행 금지(계정별 다른 slot).
  await scheduleLineBPerAccount();

  // ⛔ 네이버 블로그 트렌드 수집 **정지** (2026-09-18 · 불필요 API 정리).
  //   정보글 자동생성을 끄므로 그 전 단계인 트렌드 수집(LLM 분석 포함)도 불필요.
  await naverTrendCollectQueue
    .removeRepeatable('naver-trend-collect-daily', { pattern: NAVER_TREND_COLLECT_CRON, tz: 'Asia/Seoul' }, 'naver-trend-collect-daily')
    .catch(() => {});

  // ⛔ 네이버 정보글 자동 생성 **정지** (2026-09-18 · 불필요 API 정리).
  //   매일 INFO 카피를 LLM으로 생성 = 백그라운드 토큰 소모. 필요 시 수동 트리거로만.
  await naverDailyInfoQueue
    .removeRepeatable('naver-daily-info-daily', { pattern: NAVER_DAILY_INFO_CRON, tz: 'Asia/Seoul' }, 'naver-daily-info-daily')
    .catch(() => {});

  // 2026-09-18 불필요 API 정리: 자동 LLM 크론 전부 정지. 유지되는 유일한 반복 작업 = 계정 메트릭 동기화(LLM 없음).
  logger.info(
    {
      kept: ['account-metrics-sync-daily', 'sharing-collect-daily(태깅 OFF · Relay)'],
      stopped: [
        'trend-poll-daily',
        'trend-search-daily',
        'trend-digest-daily(발굴 푸시)',
        'sharing-publish-daily',
        'shopping-publish-daily',
        'naver-trend-collect-daily',
        'naver-daily-info-daily',
        'line-b-*',
      ],
      accountMetricsCron: ACCOUNT_METRICS_CRON,
    },
    'trend jobs: 자동 LLM 크론 정지 · 계정 메트릭만 유지',
  );
}

/**
 * 활성 계정마다 Line B 발행 잡을 서로 다른 시각(slot)에 등록.
 * jobId = line-b-<accountId> 로 idempotent. 계정 순서(handle)로 slot 배정 → 안정적.
 */
// ⛔ Line B 자동 발행 **정지** (2026-09-07). 이유: "미니 큐레이션"이 관련성 낮은 상품 3개를
//   산만하게 광고 → 사용자 불만. 단일 상품 + 이미지 확보 방식으로 재설계 후 true 로 재활성.
//   수동 /lineb 는 계속 사용 가능. false 면 재시작해도 기존 스케줄러 제거해 자동 발행 안 함.
const LINE_B_AUTO_ENABLED = false;

async function scheduleLineBPerAccount(): Promise<void> {
  if (!LINE_B_AUTO_ENABLED) {
    try {
      const scheds = await lineBPublishQueue.getJobSchedulers();
      for (const s of scheds) {
        const id = (s as { key?: string; id?: string }).key ?? (s as { id?: string }).id;
        if (id) await lineBPublishQueue.removeJobScheduler(id).catch(() => {});
      }
      logger.info({ removed: scheds.length }, 'Line B 자동 크론 정지 (LINE_B_AUTO_ENABLED=false)');
    } catch (err) {
      logger.warn({ err }, 'Line B 스케줄러 제거 실패');
    }
    return;
  }
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, handle: true },
    orderBy: { handle: 'asc' },
  });
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i]!;
    const pattern = LINE_B_SLOTS[i % LINE_B_SLOTS.length]!;
    await lineBPublishQueue.add(
      `line-b-${acc.id}`,
      { accountId: acc.id },
      {
        repeat: { pattern, tz: 'Asia/Seoul' },
        jobId: `line-b-${acc.id}`,
      },
    );
    logger.info({ handle: acc.handle, pattern }, 'Line B per-account cron scheduled');
  }
}
