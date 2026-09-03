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

function buildPreviewCaption(post: PostWithRelations, hasProductThumb: boolean): string {
  const lines: string[] = [];
  lines.push('🧵 승인 요청');
  lines.push(`계정: ${post.account.handle}`);
  if (post.commerceProduct) {
    lines.push(`상품: ${post.commerceProduct.productName} (${post.commerceProduct.channel})`);
  }
  if (hasProductThumb) {
    lines.push('⚠️  마지막 이미지 = 매칭된 쿠팡 상품 (원본과 비교 · 다르면 리젝)');
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

  const keyboard = approvalKeyboard(post.id);

  const baseMediaUrls = post.mediaUrls.length > 0
    ? post.mediaUrls
    : post.mediaUrl
      ? [post.mediaUrl]
      : [];

  // 승인 카드 검증용: 매칭된 상품 썸네일을 미디어 그룹 끝에 붙임 (원본 이미지와 시각 비교용).
  // 사용자님이 매칭 오류를 즉시 잡을 수 있게. Telegram media group 최대 10개 하드 리밋.
  const productThumb = post.commerceProduct?.thumbnailUrl;
  const showProductThumb = Boolean(productThumb) && baseMediaUrls.length > 0 && baseMediaUrls.length < 10;
  const mediaUrls = showProductThumb ? [...baseMediaUrls, productThumb!] : baseMediaUrls;
  const caption = buildPreviewCaption(post, showProductThumb);

  let anchorMessageId: number;

  // URL 패턴으로 image/video 판정 (.mp4 or Cloudinary /video/upload/)
  const isVideoUrl = (u: string) =>
    /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');

  // Telegram: (a) URL 확장자로 포맷 판별 → Cloudinary 비디오 URL 에 .mp4 없으면 실패
  //           (b) 20MB 초과 비디오는 fetch 못함 → Cloudinary transform 으로 폭·품질 축소
  const withTelegramSafe = (u: string): string => {
    let out = u;
    // (a) 확장자 보정
    if (isVideoUrl(out) && !/\.mp4(?:\?|$)/i.test(out)) {
      out = out.split('?')[0] + '.mp4' + (out.includes('?') ? '?' + out.split('?').slice(1).join('?') : '');
    }
    // (b) Cloudinary /video/upload/ 뒤에 w_720,q_auto 삽입 (트랜스코드 안 되어 있으면 자동 생성)
    if (out.includes('res.cloudinary.com') && out.includes('/video/upload/')) {
      out = out.replace('/video/upload/', '/video/upload/w_720,q_auto,vc_h264/');
    }
    return out;
  };

  if (mediaUrls.length >= 2) {
    // Media group: 각 항목별 video/photo 타입 지정 · 확장자 보정
    const group = mediaUrls.slice(0, 10).map((url, i) => ({
      type: (isVideoUrl(url) ? 'video' : 'photo') as 'photo' | 'video',
      media: withTelegramSafe(url),
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
    const only = withTelegramSafe(mediaUrls[0]!);
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
  // 이미 같은 상태이면 idempotent skip (프로그램·크론이 이미 마킹한 뒤 사용자 클릭 케이스)
  if (post.state === nextState) {
    return `이미 ${nextState} 상태`;
  }
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
