import { Worker } from 'bullmq';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES } from '../queues/queues.js';
import { logger } from '../config/logger.js';

// Phase 3에서 각 노드 로직 채움. 지금은 스켈레톤.

export function startAllWorkers() {
  const workers: Worker[] = [];

  workers.push(
    new Worker(
      QUEUE_NAMES.CLASSIFY,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'classify job received (stub)');
      },
      { connection: redisConnection },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.MATCH_PRODUCT,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'match-product job received (stub)');
      },
      { connection: redisConnection },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.COPYWRITE,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'copywrite job received (stub)');
      },
      { connection: redisConnection },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.APPROVE,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'approve job received (stub)');
      },
      { connection: redisConnection },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.PUBLISH,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'publish job received (stub)');
      },
      { connection: redisConnection },
    ),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.ENGAGEMENT,
      async (job) => {
        logger.info({ jobId: job.id, data: job.data }, 'engagement job received (stub)');
      },
      { connection: redisConnection },
    ),
  );

  logger.info(`Started ${workers.length} workers`);
  return workers;
}
