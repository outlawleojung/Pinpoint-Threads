import { ThreadsClient, type ThreadsPublishResult, type ThreadsReplyResult } from '../../../infra/threads-client.js';
import { logger } from '../../../config/logger.js';

/**
 * Publisher — 2-step 발행 오케스트레이션.
 * 1) 본문 + 미디어 발행 → threadsPostId 획득
 * 2) 그 postId에 고정 댓글 즉시 등록
 *
 * Threads Graph API OAuth 완료 후 (Phase 4) 실 사용.
 * 자동 링크 프리뷰 억제 이슈: docs/09-agents/pipeline-a/reply-composer.md 참조.
 */

const client = new ThreadsClient();

export interface PublishInput {
  accessToken: string;
  body: string;
  mediaUrls: string[];       // 이미 Cloudinary에 업로드된 공개 URL
  pinnedCommentText: string; // Reply Composer 결과 (고정 댓글)
}

export interface PublishResult {
  threadsPostId: string;
  threadsReplyId: string;
}

export async function publish(input: PublishInput): Promise<PublishResult> {
  // TODO(Phase 4b): ThreadsClient.publish는 아직 stub — Meta 승인 후 실 구현
  const main = await client.publish({
    accessToken: input.accessToken,
    text: input.body,
    mediaUrl: input.mediaUrls[0], // 다중 미디어는 Threads carousel API 별도
  });

  const reply = await client.reply({
    accessToken: input.accessToken,
    parentId: main.threadsPostId,
    text: input.pinnedCommentText,
  });

  logger.info(
    { threadsPostId: main.threadsPostId, replyId: reply.threadsReplyId },
    'publish success',
  );

  return {
    threadsPostId: main.threadsPostId,
    threadsReplyId: reply.threadsReplyId,
  };
}
