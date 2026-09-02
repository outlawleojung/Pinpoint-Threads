import { ThreadsClient } from '../../../infra/threads-client.js';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { refreshAccountToken } from './oauth/token-service.js';

/**
 * Publisher — 2-step 발행 오케스트레이션.
 *
 * 흐름:
 *   1) Account 검증 (활성 · 토큰 유효)
 *   2) 만료 임박 시 자동 refresh
 *   3) 본문 + 미디어(carousel 포함) 발행 → threadsPostId
 *   4) 고정 댓글 발행 → threadsReplyId
 *   5) Post 레코드 상태 전이 (APPROVED → PUBLISHING → PUBLISHED / FAILED)
 */

const client = new ThreadsClient();

const REFRESH_IF_EXPIRES_WITHIN_MS = 7 * 24 * 60 * 60 * 1000; // 7일

export interface PublishInput {
  postId: string;
}

export interface PublishResult {
  postId: string;
  threadsPostId: string;
  threadsReplyId: string | null;
  publishedAt: Date;
}

export class PublisherError extends Error {
  constructor(
    message: string,
    public readonly code: 'ACCOUNT_INACTIVE' | 'TOKEN_MISSING' | 'INVALID_STATE' | 'API_ERROR',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PublisherError';
  }
}

export async function publish(input: PublishInput): Promise<PublishResult> {
  const post = await prisma.post.findUnique({
    where: { id: input.postId },
    include: { account: true },
  });

  if (!post) throw new PublisherError(`Post ${input.postId} not found`, 'INVALID_STATE');
  if (post.state !== 'APPROVED' && post.state !== 'FAILED') {
    throw new PublisherError(
      `Post ${input.postId} state is ${post.state}, expected APPROVED or FAILED`,
      'INVALID_STATE',
    );
  }
  if (!post.generatedBody) {
    throw new PublisherError(`Post ${input.postId} has no generatedBody`, 'INVALID_STATE');
  }
  if (!post.account.isActive) {
    throw new PublisherError(
      `Account ${post.account.handle} is inactive`,
      'ACCOUNT_INACTIVE',
    );
  }
  if (!post.account.accessToken || !post.account.tokenExpiresAt) {
    throw new PublisherError(
      `Account ${post.account.handle} has no valid token`,
      'TOKEN_MISSING',
    );
  }

  let accessToken = post.account.accessToken;
  const msUntilExpiry = post.account.tokenExpiresAt.getTime() - Date.now();
  if (msUntilExpiry < REFRESH_IF_EXPIRES_WITHIN_MS) {
    try {
      const refreshed = await refreshAccountToken(post.account.id);
      const reread = await prisma.account.findUnique({ where: { id: post.account.id } });
      accessToken = reread!.accessToken;
      logger.info({ handle: post.account.handle, newExpiry: refreshed.expiresAt }, 'pre-publish refresh');
    } catch (err) {
      logger.warn({ err, handle: post.account.handle }, 'pre-publish refresh failed, using existing token');
    }
  }

  await prisma.post.update({
    where: { id: post.id },
    data: { state: 'PUBLISHING' },
  });

  let threadsPostId: string;
  let threadsReplyId: string | null = null;
  try {
    const main = await client.publish({
      accessToken,
      text: post.generatedBody,
      mediaUrls: post.mediaUrls ?? [],
    });
    threadsPostId = main.threadsPostId;
    logger.info({ postId: post.id, threadsPostId, handle: post.account.handle }, 'main post published');

    if (post.generatedReply) {
      // 비디오 포함 게시글은 Meta 후단 처리가 이어지므로 reply 전 대기 필요.
      // 이미지만이면 즉시 reply 가능.
      const hasVideo = (post.mediaUrls ?? []).some(
        (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/'),
      );
      const replyDelayMs = hasVideo ? 15_000 : 1_000;

      // 재시도 로직: reply 실패 시 지수 백오프 최대 3회 (비디오 후단 처리 대기)
      const maxAttempts = hasVideo ? 4 : 2;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const wait = attempt === 1 ? replyDelayMs : replyDelayMs * attempt;
        logger.info({ postId: post.id, attempt, waitMs: wait, hasVideo }, 'waiting before pinned reply');
        await new Promise((r) => setTimeout(r, wait));
        try {
          const reply = await client.reply({
            accessToken,
            parentId: threadsPostId,
            text: post.generatedReply,
          });
          threadsReplyId = reply.threadsReplyId;
          logger.info({ postId: post.id, threadsReplyId, attempt }, 'pinned reply published');
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          logger.warn({ err, postId: post.id, attempt, maxAttempts }, 'pinned reply attempt failed, retrying');
        }
      }
      if (lastErr) {
        logger.error({ err: lastErr, postId: post.id, threadsPostId }, 'pinned reply failed after retries — main post is live but reply missing');
      }
    }
  } catch (err) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        state: 'FAILED',
        rejectionReason: String((err as Error)?.message ?? err),
        retryCount: { increment: 1 },
      },
    });
    logger.error({ err, postId: post.id }, 'publish failed');
    throw new PublisherError('Threads publish failed', 'API_ERROR', err);
  }

  const publishedAt = new Date();
  await prisma.post.update({
    where: { id: post.id },
    data: {
      state: 'PUBLISHED',
      publishedAt,
      threadsPostId,
      threadsReplyId,
    },
  });

  return { postId: post.id, threadsPostId, threadsReplyId, publishedAt };
}
