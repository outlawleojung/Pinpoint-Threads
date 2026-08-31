import { Worker } from 'bullmq';
import { redisConnection } from '../queues/connection.js';
import { QUEUE_NAMES, type PublishJob } from '../queues/queues.js';
import { logger } from '../config/logger.js';
import { publish as runPublisher, PublisherError } from '../modules/shared/publisher/index.js';
import { collectSnapshot, schedulePerformanceSnapshots } from '../modules/shared/performance-collector/index.js';
import type { PerformanceCollectJob } from '../queues/queues.js';

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
    new Worker<PublishJob>(
      QUEUE_NAMES.PUBLISH,
      async (job) => {
        const { postId } = job.data;
        logger.info({ jobId: job.id, postId }, 'publish job start');
        try {
          const result = await runPublisher({ postId });
          logger.info(
            {
              jobId: job.id,
              postId,
              threadsPostId: result.threadsPostId,
              threadsReplyId: result.threadsReplyId,
            },
            'publish job done',
          );
          // 성공 시 24h · 72h 스냅샷 예약
          try {
            await schedulePerformanceSnapshots({
              postId,
              publishedAt: result.publishedAt,
            });
          } catch (err) {
            logger.warn({ err, postId }, 'schedule snapshots failed (publish still success)');
          }
          return result;
        } catch (err) {
          if (err instanceof PublisherError) {
            logger.error({ jobId: job.id, postId, code: err.code, msg: err.message }, 'publish failed (PublisherError)');
          } else {
            logger.error({ jobId: job.id, postId, err }, 'publish failed (unexpected)');
          }
          throw err;
        }
      },
      { connection: redisConnection, concurrency: 2 },
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

  workers.push(
    new Worker<PerformanceCollectJob>(
      QUEUE_NAMES.PERFORMANCE_COLLECT,
      async (job) => {
        const { postId, hoursAfterPublish } = job.data;
        logger.info({ jobId: job.id, postId, hoursAfterPublish }, 'performance-collect start');
        const result = await collectSnapshot({ postId, hoursAfterPublish });
        logger.info({ jobId: job.id, result }, 'performance-collect done');
        return result;
      },
      { connection: redisConnection, concurrency: 2 },
    ),
  );

  logger.info(`Started ${workers.length} workers`);
  return workers;
}
