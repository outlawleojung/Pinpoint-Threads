import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { ThreadsClient } from '../../../infra/threads-client.js';
import { refreshAccountToken } from '../publisher/oauth/token-service.js';

/**
 * Performance Collector (Task #21).
 *
 * 발행된 Post의 24h·72h 시점 Threads Insights 회수 → PostInsightSnapshot 저장.
 * engagementScore 자동 계산 → 벤치마크 승격 · 재활용 판단 근거.
 *
 * schedulePerformanceSnapshots(postId): Post PUBLISHED 후 24h·72h 시점에 큐 delayed job 등록.
 * collectSnapshot(postId, hoursAfterPublish): 실 fetch + 저장.
 */

const client = new ThreadsClient();

export interface CollectResult {
  snapshotId: string;
  postId: string;
  hoursAfterPublish: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  views: number;
  engagementScore: number;
}

export class PerformanceCollectorError extends Error {
  constructor(
    message: string,
    public readonly code: 'POST_NOT_FOUND' | 'NOT_PUBLISHED' | 'MISSING_TOKEN' | 'API_ERROR',
  ) {
    super(message);
    this.name = 'PerformanceCollectorError';
  }
}

export async function collectSnapshot(input: {
  postId: string;
  hoursAfterPublish: number;
}): Promise<CollectResult> {
  const post = await prisma.post.findUnique({
    where: { id: input.postId },
    include: { account: true },
  });
  if (!post) throw new PerformanceCollectorError('Post not found', 'POST_NOT_FOUND');
  if (post.state !== 'PUBLISHED' || !post.threadsPostId) {
    throw new PerformanceCollectorError(
      `Post ${input.postId} state=${post.state}, threadsPostId=${post.threadsPostId}`,
      'NOT_PUBLISHED',
    );
  }
  if (!post.account.accessToken) {
    throw new PerformanceCollectorError('account token missing', 'MISSING_TOKEN');
  }

  // 토큰 임박 시 refresh
  let accessToken = post.account.accessToken;
  if (
    post.account.tokenExpiresAt &&
    post.account.tokenExpiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
  ) {
    try {
      await refreshAccountToken(post.account.id);
      const reread = await prisma.account.findUnique({ where: { id: post.account.id } });
      accessToken = reread!.accessToken;
    } catch (err) {
      logger.warn({ err, handle: post.account.handle }, 'pre-collect refresh failed');
    }
  }

  let insights;
  try {
    insights = await client.fetchInsights({
      accessToken,
      threadsPostId: post.threadsPostId,
    });
  } catch (err) {
    logger.error({ err, postId: input.postId }, 'insights fetch failed');
    throw new PerformanceCollectorError(
      `insights API failed: ${(err as Error).message}`,
      'API_ERROR',
    );
  }

  const likes = insights.likes ?? 0;
  const replies = insights.replies ?? 0;
  const reposts = insights.reposts ?? 0;
  const quotes = insights.quotes ?? 0;
  const views = insights.views ?? 0;

  // engagementScore = (likes + replies*3 + reposts*5 + quotes*4) / max(views, 1)
  // 가중치 이유: repost > quote > reply > like (확산 기여도 순)
  const rawScore = likes + replies * 3 + reposts * 5 + quotes * 4;
  const engagementScore = rawScore / Math.max(views, 1);

  const snapshot = await prisma.postInsightSnapshot.upsert({
    where: {
      postId_hoursAfterPublish: {
        postId: input.postId,
        hoursAfterPublish: input.hoursAfterPublish,
      },
    },
    create: {
      postId: input.postId,
      hoursAfterPublish: input.hoursAfterPublish,
      likes,
      replies,
      reposts,
      quotes,
      views,
      engagementScore,
      raw: insights as any,
    },
    update: {
      likes,
      replies,
      reposts,
      quotes,
      views,
      engagementScore,
      collectedAt: new Date(),
      raw: insights as any,
    },
  });

  logger.info(
    {
      postId: input.postId,
      handle: post.account.handle,
      hours: input.hoursAfterPublish,
      likes,
      replies,
      reposts,
      quotes,
      views,
      engagementScore: engagementScore.toFixed(4),
    },
    'performance snapshot collected',
  );

  return {
    snapshotId: snapshot.id,
    postId: input.postId,
    hoursAfterPublish: input.hoursAfterPublish,
    likes,
    replies,
    reposts,
    quotes,
    views,
    engagementScore,
  };
}

/**
 * 발행 완료 시 호출 → 24h · 72h 시점에 스냅샷 잡 등록.
 */
export async function schedulePerformanceSnapshots(input: {
  postId: string;
  publishedAt: Date;
}): Promise<void> {
  const { performanceQueue } = await import('../../../queues/queues.js');
  const now = Date.now();
  const scheduleAt = [24, 72];

  for (const h of scheduleAt) {
    const target = input.publishedAt.getTime() + h * 60 * 60 * 1000;
    const delay = Math.max(0, target - now);
    await performanceQueue.add(
      `snapshot-${input.postId}-${h}h`,
      { postId: input.postId, hoursAfterPublish: h },
      { delay, jobId: `snapshot-${input.postId}-${h}h` },
    );
    logger.info(
      { postId: input.postId, hours: h, delayHours: (delay / 3_600_000).toFixed(1) },
      'performance snapshot scheduled',
    );
  }
}
