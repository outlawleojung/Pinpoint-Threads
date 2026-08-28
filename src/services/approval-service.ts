import type { Post, Account, CommerceProduct, SourceItem } from '@prisma/client';
import { PostState } from '@prisma/client';
import { bot } from '../adapters/telegram/bot.js';
import { approvalKeyboard } from '../adapters/telegram/keyboards.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db/prisma.js';
import { assertTransition } from '../state/post-state-machine.js';

type PostWithRelations = Post & {
  account: Account;
  sourceItem: SourceItem;
  commerceProduct: CommerceProduct | null;
};

function buildPreviewCaption(post: PostWithRelations): string {
  const lines: string[] = [];
  lines.push(`🧵 *승인 요청*`);
  lines.push(`계정: \`${post.account.handle}\``);
  if (post.commerceProduct) {
    lines.push(`상품: ${post.commerceProduct.productName} (${post.commerceProduct.channel})`);
  }
  lines.push('');
  lines.push('*본문*');
  lines.push(post.generatedBody ?? '(비어있음)');
  lines.push('');
  lines.push('*고정 댓글*');
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

  const message = post.mediaUrl
    ? await bot.api.sendPhoto(env.TELEGRAM_ADMIN_CHAT_ID, post.mediaUrl, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      })
    : await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, caption, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });

  await prisma.post.update({
    where: { id: post.id },
    data: {
      state: PostState.PENDING_APPROVAL,
      telegramMessageId: String(message.message_id),
    },
  });

  logger.info({ postId, messageId: message.message_id }, 'approval request sent');
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

  // TODO(Phase 3): 각 상태에 해당하는 큐 잡 투입
  // approve → publishQueue.add(...)
  // regen-text → copywriteQueue.add(...)
  // regen-product → matchProductQueue.add(...)

  const labels: Record<Action, string> = {
    approve: '✅ 승인 → 발행 큐 대기',
    'regen-text': '📝 텍스트 재생성 큐 대기',
    'regen-product': '🔄 상품 재검색 큐 대기',
    reject: '🗑 폐기 처리',
  };
  return labels[action];
}
