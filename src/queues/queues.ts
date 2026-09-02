import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from './connection.js';

export const QUEUE_NAMES = {
  COLLECT: 'collect',
  CLASSIFY: 'classify',
  MATCH_PRODUCT: 'match-product',
  COPYWRITE: 'copywrite',
  APPROVE: 'approve',
  PUBLISH: 'publish',
  ENGAGEMENT: 'engagement',
  TREND_POLL: 'trend-poll',
  TREND_DIGEST: 'trend-digest',
  TREND_SEARCH: 'trend-search',
  SHARING_COLLECT: 'sharing-collect',
  SHARING_PUBLISH: 'sharing-publish',
  ACCOUNT_METRICS_SYNC: 'account-metrics-sync',
  SHOPPING_PUBLISH: 'shopping-publish',
  PERFORMANCE_COLLECT: 'performance-collect',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type CollectJob = { sourceUrl: string };
export type ClassifyJob = { sourceItemId: string };
export type MatchProductJob = { postId: string };
export type CopywriteJob = { postId: string };
export type ApproveJob = { postId: string };
export type PublishJob = { postId: string };
export type EngagementJob = {
  accountId: string;
  targetHandle: string;
  targetPostId: string;
};
export type TrendPollJob = { triggeredBy?: string };
export type TrendDigestJob = { limit?: number };
export type TrendSearchJob = {
  topSignals?: number;
  perPlatformResults?: number;
  minLikes?: number;
};
export type SharingCollectJob = { triggeredBy?: string };
export type SharingPublishJob = { triggeredBy?: string };
export type AccountMetricsSyncJob = { triggeredBy?: string };
export type ShoppingPublishJob = { triggeredBy?: string };
export type PerformanceCollectJob = { postId: string; hoursAfterPublish: number };

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export const collectQueue = new Queue<CollectJob>(QUEUE_NAMES.COLLECT, {
  connection: redisConnection,
  defaultJobOptions,
});

export const classifyQueue = new Queue<ClassifyJob>(QUEUE_NAMES.CLASSIFY, {
  connection: redisConnection,
  defaultJobOptions,
});

export const matchProductQueue = new Queue<MatchProductJob>(QUEUE_NAMES.MATCH_PRODUCT, {
  connection: redisConnection,
  defaultJobOptions,
});

export const copywriteQueue = new Queue<CopywriteJob>(QUEUE_NAMES.COPYWRITE, {
  connection: redisConnection,
  defaultJobOptions,
});

export const approveQueue = new Queue<ApproveJob>(QUEUE_NAMES.APPROVE, {
  connection: redisConnection,
  defaultJobOptions,
});

export const publishQueue = new Queue<PublishJob>(QUEUE_NAMES.PUBLISH, {
  connection: redisConnection,
  defaultJobOptions,
});

export const engagementQueue = new Queue<EngagementJob>(QUEUE_NAMES.ENGAGEMENT, {
  connection: redisConnection,
  defaultJobOptions,
});

export const trendPollQueue = new Queue<TrendPollJob>(QUEUE_NAMES.TREND_POLL, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: { age: 3 * 24 * 3600, count: 100 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export const trendDigestQueue = new Queue<TrendDigestJob>(QUEUE_NAMES.TREND_DIGEST, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { age: 3 * 24 * 3600, count: 30 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export const trendSearchQueue = new Queue<TrendSearchJob>(QUEUE_NAMES.TREND_SEARCH, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1, // Apify 비용 있으니 자동 재시도 하지 않음
    removeOnComplete: { age: 3 * 24 * 3600, count: 50 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export const sharingCollectQueue = new Queue<SharingCollectJob>(QUEUE_NAMES.SHARING_COLLECT, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1, // Apify 비용 있으니 자동 재시도 금지
    removeOnComplete: { age: 7 * 24 * 3600, count: 30 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});

export const sharingPublishQueue = new Queue<SharingPublishJob>(QUEUE_NAMES.SHARING_PUBLISH, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: { age: 7 * 24 * 3600, count: 30 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});

export const accountMetricsSyncQueue = new Queue<AccountMetricsSyncJob>(QUEUE_NAMES.ACCOUNT_METRICS_SYNC, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential' as const, delay: 60_000 },
    removeOnComplete: { age: 7 * 24 * 3600, count: 30 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});

export const shoppingPublishQueue = new Queue<ShoppingPublishJob>(QUEUE_NAMES.SHOPPING_PUBLISH, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 7 * 24 * 3600, count: 30 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});

export const performanceQueue = new Queue<PerformanceCollectJob>(QUEUE_NAMES.PERFORMANCE_COLLECT, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 60_000 },
    removeOnComplete: { age: 30 * 24 * 3600, count: 500 },
    removeOnFail: { age: 60 * 24 * 3600 },
  },
});

export const queueEvents: Record<QueueName, QueueEvents> = {
  [QUEUE_NAMES.COLLECT]: new QueueEvents(QUEUE_NAMES.COLLECT, { connection: redisConnection }),
  [QUEUE_NAMES.CLASSIFY]: new QueueEvents(QUEUE_NAMES.CLASSIFY, { connection: redisConnection }),
  [QUEUE_NAMES.MATCH_PRODUCT]: new QueueEvents(QUEUE_NAMES.MATCH_PRODUCT, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.COPYWRITE]: new QueueEvents(QUEUE_NAMES.COPYWRITE, { connection: redisConnection }),
  [QUEUE_NAMES.APPROVE]: new QueueEvents(QUEUE_NAMES.APPROVE, { connection: redisConnection }),
  [QUEUE_NAMES.PUBLISH]: new QueueEvents(QUEUE_NAMES.PUBLISH, { connection: redisConnection }),
  [QUEUE_NAMES.ENGAGEMENT]: new QueueEvents(QUEUE_NAMES.ENGAGEMENT, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.TREND_POLL]: new QueueEvents(QUEUE_NAMES.TREND_POLL, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.TREND_DIGEST]: new QueueEvents(QUEUE_NAMES.TREND_DIGEST, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.TREND_SEARCH]: new QueueEvents(QUEUE_NAMES.TREND_SEARCH, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.SHARING_COLLECT]: new QueueEvents(QUEUE_NAMES.SHARING_COLLECT, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.SHARING_PUBLISH]: new QueueEvents(QUEUE_NAMES.SHARING_PUBLISH, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.ACCOUNT_METRICS_SYNC]: new QueueEvents(QUEUE_NAMES.ACCOUNT_METRICS_SYNC, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.SHOPPING_PUBLISH]: new QueueEvents(QUEUE_NAMES.SHOPPING_PUBLISH, {
    connection: redisConnection,
  }),
  [QUEUE_NAMES.PERFORMANCE_COLLECT]: new QueueEvents(QUEUE_NAMES.PERFORMANCE_COLLECT, {
    connection: redisConnection,
  }),
};
