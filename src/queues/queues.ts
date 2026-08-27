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
};
