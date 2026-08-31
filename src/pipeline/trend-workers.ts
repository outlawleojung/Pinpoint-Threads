import { Worker } from 'bullmq';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES, trendPollQueue, trendDigestQueue, trendSearchQueue } from '../queues/queues.js';
import { logger } from '../config/logger.js';
import {
  pollAllAdapters,
  getTopActiveSignals,
  decayOldSignals,
  type TrendSourceAdapter,
} from '../modules/shared/trend-signals/index.js';
import { NaverDatalabAdapter } from '../modules/shared/trend-signals/adapters/naver-datalab.js';
import { GoogleTrendsAdapter } from '../modules/shared/trend-signals/adapters/google-trends.js';
import { CoupangRankingAdapter } from '../modules/shared/trend-signals/adapters/coupang-ranking.js';
import { TikTokCreativeCenterAdapter } from '../modules/shared/trend-signals/adapters/tiktok-creative-center.js';
import { sendDigestMessage } from '../modules/shared/approval-gate/notifier.js';
import { safeRunTrendSearchIngest } from '../modules/shared/trend-signals/search-orchestrator.js';

/**
 * Lane 2 자율 트렌드 워커 · 스케줄러.
 *
 * TREND_POLL — 6시간마다 모든 어댑터 실행 + 오래된 신호 감쇠
 * TREND_DIGEST — 매일 아침 08:00 텔레그램에 상위 시그널 다이제스트
 *
 * BullMQ repeatable job 사용. 앱 재시작해도 스케줄 유지.
 */

const POLL_EVERY_MS = 6 * 60 * 60 * 1000; // 6h
const DIGEST_CRON = '0 8 * * *'; // 매일 08:00 KST
const SEARCH_CRON = '30 8 * * *'; // 매일 08:30 KST (다이제스트 이후)

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
        const limit = job.data.limit ?? 15;
        logger.info({ jobId: job.id, limit }, 'trend-digest start');
        const top = await getTopActiveSignals({ limit });
        if (top.length === 0) {
          await sendDigestMessage('📊 오늘의 트렌드 다이제스트\n\n(감지된 신호 없음. Poll 실행 필요)');
          return { sent: 0 };
        }
        const lines = top.map((s, i) => {
          const v =
            s.velocityPct == null
              ? ''
              : s.velocityPct > 0
                ? ` +${s.velocityPct.toFixed(0)}%`
                : ` ${s.velocityPct.toFixed(0)}%`;
          const cross = s.crossPlatformScore > 1 ? ` ×${s.crossPlatformScore}` : '';
          const cat = s.category ? ` [${s.category}]` : '';
          return `${i + 1}. ${s.keyword}${cat}${v}${cross}`;
        });
        const body =
          `📊 오늘의 트렌드 다이제스트 (상위 ${top.length})\n\n` +
          lines.join('\n') +
          '\n\n💡 관심 있는 항목을 각 플랫폼에서 검색해서 좋은 게시글 URL을 이 챗에 붙여넣으면 자동 처리됩니다.';

        await sendDigestMessage(body);
        return { sent: top.length };
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

  logger.info('Started 3 trend workers (trend-poll · trend-digest · trend-search)');
  return workers;
}

export async function scheduleTrendJobs(): Promise<void> {
  // repeatable poll every 6h
  await trendPollQueue.add(
    'trend-poll-repeat',
    { triggeredBy: 'scheduler' },
    {
      repeat: { every: POLL_EVERY_MS },
      jobId: 'trend-poll-repeat',
    },
  );

  // daily digest at 08:00 KST
  await trendDigestQueue.add(
    'trend-digest-daily',
    { limit: 15 },
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

  logger.info(
    { pollEveryMs: POLL_EVERY_MS, digestCron: DIGEST_CRON, searchCron: SEARCH_CRON },
    'trend jobs scheduled (repeat)',
  );
}
