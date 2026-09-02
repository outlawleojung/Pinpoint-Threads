import type { Post, Account, CommerceProduct, SourceItem } from '@prisma/client';
import { PostState } from '@prisma/client';
import { bot } from './bot.js';
import { approvalKeyboard } from './keyboards.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { assertTransition } from '../../../state/post-state-machine.js';
import { scheduleApprovedPost, SchedulerError } from '../publisher/scheduler.js';

type PostWithRelations = Post & {
  account: Account;
  sourceItem: SourceItem | null;
  commerceProduct: CommerceProduct | null;
};

function buildPreviewCaption(post: PostWithRelations): string {
  const lines: string[] = [];
  lines.push('🧵 승인 요청');
  lines.push(`계정: ${post.account.handle}`);
  if (post.commerceProduct) {
    lines.push(`상품: ${post.commerceProduct.productName} (${post.commerceProduct.channel})`);
  }
  lines.push('');
  lines.push('━━━ 본문 ━━━');
  lines.push(post.generatedBody ?? '(비어있음)');
  lines.push('');
  lines.push('━━━ 고정 댓글 ━━━');
  lines.push(post.generatedReply ?? '(비어있음)');
  return lines.join('\n');
}

export async function sendApprovalRequest(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { account: true, sourceItem: true, commerceProduct: true },
  });
  if (!post) throw new Error(`Post ${postId} not found`);

  const caption = buildPreviewCaption(post);
  const keyboard = approvalKeyboard(post.id);

  const mediaUrls = post.mediaUrls.length > 0
    ? post.mediaUrls
    : post.mediaUrl
      ? [post.mediaUrl]
      : [];

  let anchorMessageId: number;

  // URL 패턴으로 image/video 판정 (.mp4 or Cloudinary /video/upload/)
  const isVideoUrl = (u: string) =>
    /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');

  if (mediaUrls.length >= 2) {
    // Media group: 각 항목별 video/photo 타입 지정
    const group = mediaUrls.slice(0, 10).map((url, i) => ({
      type: (isVideoUrl(url) ? 'video' : 'photo') as 'photo' | 'video',
      media: url,
      caption: i === 0 ? caption : undefined,
    }));
    const groupMessages = await bot.api.sendMediaGroup(env.TELEGRAM_ADMIN_CHAT_ID, group);
    anchorMessageId = groupMessages[0]?.message_id ?? 0;

    await bot.api.sendMessage(
      env.TELEGRAM_ADMIN_CHAT_ID,
      `Post: ${post.id}\n승인 결정:`,
      { reply_markup: keyboard },
    );
  } else if (mediaUrls.length === 1) {
    const only = mediaUrls[0]!;
    const msg = isVideoUrl(only)
      ? await bot.api.sendVideo(env.TELEGRAM_ADMIN_CHAT_ID, only, { caption, reply_markup: keyboard })
      : await bot.api.sendPhoto(env.TELEGRAM_ADMIN_CHAT_ID, only, { caption, reply_markup: keyboard });
    anchorMessageId = msg.message_id;
  } else {
    const msg = await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, caption, {
      reply_markup: keyboard,
    });
    anchorMessageId = msg.message_id;
  }

  await prisma.post.update({
    where: { id: post.id },
    data: {
      state: PostState.PENDING_APPROVAL,
      telegramMessageId: String(anchorMessageId),
    },
  });

  logger.info({ postId, anchorMessageId, mediaCount: mediaUrls.length }, 'approval request sent');
}

type Action = 'approve' | 'regen-text' | 'regen-product' | 'reject';

const ACTION_TO_STATE: Record<Action, PostState> = {
  approve: PostState.APPROVED,
  'regen-text': PostState.COPYWRITING,
  'regen-product': PostState.MATCHING,
  reject: PostState.REJECTED,
};

export async function handleApprovalCallback(action: Action, postId: string): Promise<string> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return `Post ${postId} not found`;

  const nextState = ACTION_TO_STATE[action];
  assertTransition(post.state, nextState);

  await prisma.post.update({
    where: { id: postId },
    data: {
      state: nextState,
      approvedAt: action === 'approve' ? new Date() : undefined,
      rejectionReason: action === 'reject' ? 'admin rejected via telegram' : undefined,
    },
  });

  logger.info({ postId, action, from: post.state, to: nextState }, 'post state transitioned');

  // 승인 시 스케줄러가 계정 시차·활성 시간대 반영해서 delayed 발행 큐 등록
  let scheduleNote = '';
  if (action === 'approve') {
    try {
      const s = await scheduleApprovedPost(postId);
      const inMin = Math.round(s.delayMs / 60_000);
      scheduleNote = ` @ ${s.scheduledAt.toISOString().slice(5, 16).replace('T', ' ')} (${inMin}분 후)`;
    } catch (err) {
      if (err instanceof SchedulerError) {
        logger.error({ postId, code: err.code, msg: err.message }, 'schedule failed after approve');
      } else {
        logger.error({ postId, err }, 'schedule failed after approve (unexpected)');
      }
      scheduleNote = ` ⚠ 스케줄 실패: ${(err as Error).message}`;
    }
  }

  // TODO: regen-text · regen-product 큐 잡 투입 (별도 태스크)

  const labels: Record<Action, string> = {
    approve: '✅ 승인' + scheduleNote,
    'regen-text': '📝 텍스트 재생성 (큐 미구현)',
    'regen-product': '🔄 상품 재검색 (큐 미구현)',
    reject: '🗑 폐기 처리',
  };
  return labels[action];
}
