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
} from '../queues/queues.js';
import { logger } from '../config/logger.js';
import {
  pollAllAdapters,
  decayOldSignals,
  type TrendSourceAdapter,
} from '../modules/shared/trend-signals/index.js';
import { generatePostableTopics } from '../modules/shared/trend-signals/topic-generator.js';
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

/**
 * Lane 2 자율 트렌드 워커 · 스케줄러.
 *
 * TREND_POLL — 6시간마다 모든 어댑터 실행 + 오래된 신호 감쇠
 * TREND_DIGEST — 매일 아침 08:00 텔레그램에 상위 시그널 다이제스트
 *
 * BullMQ repeatable job 사용. 앱 재시작해도 스케줄 유지.
 */

const POLL_CRON = '0 7 * * *'; // 매일 07:00 KST (하루 1회. 이전 6h → 하루 1회로 축소)
const DIGEST_CRON = '0 8 * * *'; // 매일 08:00 KST
const SEARCH_CRON = '30 8 * * *'; // 매일 08:30 KST (다이제스트 이후)
const SHARING_CRON = '0 8 * * *';  // 매일 08:00 KST (Pipeline B 스하리 벤치마크 수집 · publish 1h 전)
const SHARING_PUBLISH_CRON = '0 9 * * *'; // 매일 09:00 KST (Pipeline B 계정별 스하리 카피 생성 → 승인 카드)
const ACCOUNT_METRICS_CRON = '30 7 * * *'; // 매일 07:30 KST (계정 팔로워·나이 갱신 · publish 1.5h 전)
const SHOPPING_PUBLISH_CRON = '0 9 * * *'; // 매일 09:00 KST (쇼핑 카피 생성 · 발행 slot 은 계정별 시차)

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
        const perBucket = job.data.perBucket ?? job.data.limit ?? 6;
        logger.info({ jobId: job.id, perBucket }, 'trend-digest start');

        // 원시 신호가 아니라 **발행 가능한 주제(앵글)** 로 변환 (topic-generator).
        //   - shopping[]: 트렌드 상품/카테고리 → 비교·최저가·추천 앵글 (Line B)
        //   - engagement[]: 일상·공감 훅 (인물·정치·스포츠 하드 드롭)
        const topics = await generatePostableTopics({ perBucket });

        if (topics.shopping.length === 0 && topics.engagement.length === 0) {
          await sendDigestMessage('📊 오늘의 트렌드 주제\n\n(발행 가능한 주제 없음 — 신호 부족)');
          return { shopping: 0, engagement: 0 };
        }

        const fmt = (t: (typeof topics.shopping)[number], i: number) =>
          `${i + 1}. ${t.title}\n   └ ${t.angle} · 근거: ${t.basis}\n   💬 "${t.hook}"`;

        const sections: string[] = ['📊 오늘의 트렌드 발행 주제'];
        if (topics.shopping.length) {
          sections.push('🛒 쇼핑 앵글 (비교·최저가·추천)\n' + topics.shopping.map(fmt).join('\n'));
        }
        if (topics.engagement.length) {
          sections.push('💬 일상·공감 훅\n' + topics.engagement.map(fmt).join('\n'));
        }
        sections.push(
          '💡 마음에 드는 주제로 각 플랫폼에서 좋은 게시글 URL을 찾아 붙여넣으면 자동 처리됩니다.',
        );

        await sendDigestMessage(sections.join('\n\n'));
        return { shopping: topics.shopping.length, engagement: topics.engagement.length };
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

  logger.info(
    'Started 7 trend workers (trend-poll · trend-digest · trend-search · sharing-collect · sharing-publish · account-metrics-sync · shopping-publish)',
  );
  return workers;
}

export async function scheduleTrendJobs(): Promise<void> {
  // daily poll at 07:00 KST (하루 1회. 다이제스트 1h 전)
  await trendPollQueue.add(
    'trend-poll-daily',
    { triggeredBy: 'scheduler' },
    {
      repeat: { pattern: POLL_CRON, tz: 'Asia/Seoul' },
      jobId: 'trend-poll-daily',
    },
  );

  // daily digest at 08:00 KST
  await trendDigestQueue.add(
    'trend-digest-daily',
    { perBucket: 6 },
    {
      repeat: { pattern: DIGEST_CRON, tz: 'Asia/Seoul' },
      jobId: 'trend-digest-daily',
    },
  );

  // daily trend-driven search + auto ingest
  await trendSearchQueue.add(
    'trend-search-daily',
    { topSignals: 5, perPlatformResults: 10, minLikes: 100 },
    {
      repeat: { pattern: SEARCH_CRON, tz: 'Asia/Seoul' },
      jobId: 'trend-search-daily',
    },
  );

  // daily Pipeline B 스하리 해시태그 벤치마크 수집
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

  // daily Pipeline B 스하리 카피 생성 → 승인 카드 (계정별 1건, 하드 dedup 24h)
  await sharingPublishQueue.add(
    'sharing-publish-daily',
    { triggeredBy: 'scheduler' },
    {
      repeat: { pattern: SHARING_PUBLISH_CRON, tz: 'Asia/Seoul' },
      jobId: 'sharing-publish-daily',
    },
  );

  // ⛔ 자동 쇼핑 발행 크론 **정지** (2026-09-04 사용자 방침).
  //   이유: 좋아요순 top 벤치마크를 5계정에 동시·동일 콘텐츠로 뿌려 "매일 각 계정 똑같은 쇼핑글" 발생.
  //   대체: 수동 URL+상품명 흐름만 사용. 향후 "한 계정 발행 → 반응 좋으면 타 계정 확산"(성과 게이팅) 별도 구현 예정.
  //   기존에 등록된 repeatable job 은 removeRepeatable 로 제거 필요 (scripts 참고).
  // await shoppingPublishQueue.add('shopping-publish-daily', ...);
  await shoppingPublishQueue
    .removeRepeatable('shopping-publish-daily', { pattern: SHOPPING_PUBLISH_CRON, tz: 'Asia/Seoul' }, 'shopping-publish-daily')
    .catch(() => {});

  logger.info(
    {
      pollCron: POLL_CRON,
      digestCron: DIGEST_CRON,
      searchCron: SEARCH_CRON,
      sharingCron: SHARING_CRON,
      sharingPublishCron: SHARING_PUBLISH_CRON,
    },
    'trend jobs scheduled (repeat)',
  );
}
