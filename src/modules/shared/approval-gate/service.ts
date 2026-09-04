import type { Post, Account, CommerceProduct, SourceItem } from '@prisma/client';
import { PostState } from '@prisma/client';
import { bot } from './bot.js';
import { approvalKeyboard } from './keyboards.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { assertTransition } from '../../../state/post-state-machine.js';
import { publishQueue } from '../../../queues/queues.js';
import { generateCopy } from '../copywriter/index.js';
import { composeReply } from '../../pipeline-a/reply-composer/index.js';

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

  const allMediaUrls = post.mediaUrls.length > 0
    ? post.mediaUrls
    : post.mediaUrl
      ? [post.mediaUrl]
      : [];

  // URL 패턴으로 image/video 판정
  const isVideoUrl = (u: string) =>
    /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');

  // Telegram 승인 카드 전략: 비디오는 URL fetch 실패 잦음 (크기·Cloudinary transform 지연).
  // → 이미지만 미리보기로 사용 · 비디오는 개수만 캡션에 명시.
  // 실 발행 시 Threads API 에는 all media (mp4 포함) 그대로 전달됨.
  const imageOnly = allMediaUrls.filter((u) => !isVideoUrl(u));
  const videoCount = allMediaUrls.length - imageOnly.length;
  const baseMediaUrls = imageOnly;

  // 승인 카드 검증용: 매칭된 상품 썸네일 첨부 (원본과 시각 비교)
  const productThumb = post.commerceProduct?.thumbnailUrl;
  const showProductThumb = Boolean(productThumb) && baseMediaUrls.length > 0 && baseMediaUrls.length < 10;
  const mediaUrls = showProductThumb ? [...baseMediaUrls, productThumb!] : baseMediaUrls;
  const captionCore = buildPreviewCaption(post, showProductThumb);
  // 비디오 포함 여부를 카드 최상단에 명확히 (사용자가 발행 전 확인 가능하게)
  const videoBadge = videoCount > 0
    ? `🎬 비디오 ${videoCount}개 포함됨 ✅ (프리뷰엔 이미지만 · 발행 시 비디오 나감)`
    : `🖼 비디오 없음 · 이미지 ${imageOnly.length}개`;
  const caption = `${videoBadge}\n\n${captionCore}`;

  let anchorMessageId: number;

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

  logger.info({ postId, anchorMessageId, mediaCount: mediaUrls.length, videoCount }, 'approval request sent');
}

type Action = 'approve' | 'regen-text' | 'regen-product' | 'reject';

/**
 * 텔레그램 "텍스트 재생성" — 같은 상품·소스로 카피/고정댓글만 다시 생성 후 승인 카드 재발송.
 * 이전 카피를 회피 힌트로 넘겨 다른 각도의 문장이 나오게 함.
 */
async function regenerateCopyAndResend(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { account: true, sourceItem: true, commerceProduct: true },
  });
  if (!post) throw new Error('post not found');
  if (!post.commerceProduct) throw new Error('상품 정보 없음 · 재생성 불가');

  const isVideoUrl = (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');
  // 원본 벤치마크 이미지(sourceMediaUrls)는 IG/Threads CDN 이라 ~10분 후 만료 → 재생성 시점엔 죽어있음.
  // Cloudinary 재호스팅된 mediaUrls(영구) 이미지를 우선, 없으면 원본 fallback.
  const uploadedImg = post.mediaUrls.find((u) => !isVideoUrl(u));
  const originalImg = post.sourceMediaUrls.find((u) => !isVideoUrl(u));
  const sourceImageForCopy = uploadedImg ?? originalImg;
  const channel = post.commerceProduct.channel as 'COUPANG' | 'MUSINSA' | 'NAVER';
  const category = post.commerceProduct.category ?? undefined;
  const deeplinkUrl = post.commerceProduct.deeplinkUrl ?? undefined;

  const copy = await generateCopy({
    sourceText: post.sourceItem?.rawText ?? '',
    sourceImageUrl: sourceImageForCopy,
    productName: post.commerceProduct.productName,
    productCategory: category,
    accountSeed: post.accountId,
    accountId: post.accountId,
    personaPrompt: post.account.personaPrompt,
    deeplinkUrl,
    channel,
    ragEnabled: true,
    factCheckEnabled: true,
    regenAvoid: post.generatedBody
      ? `이전 카피와 확실히 다른 문장·다른 각도로 (그대로 반복 금지): "${post.generatedBody}"`
      : undefined,
  });
  const reply = await composeReply({
    body: copy.body,
    productName: post.commerceProduct.productName,
    productCategory: category,
    deeplinkUrl,
    accountId: post.accountId,
    personaPrompt: post.account.personaPrompt,
    channel,
  });
  await prisma.post.update({
    where: { id: postId },
    data: { generatedBody: copy.body, generatedReply: reply.text },
  });
  // sendApprovalRequest 가 state → PENDING_APPROVAL 로 되돌리고 새 카드 발송
  await sendApprovalRequest(postId);
}

export async function handleApprovalCallback(action: Action, postId: string): Promise<string> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return `Post ${postId} not found`;

  // 상품 재검색: 자동 매처는 같은 검색어로 재실행해도 같은 top 을 반환해 실효 없음.
  // 정확한 교체는 "리젝 → 정확한 상품명 재전송" 흐름이 맞음 → 상태 변경 없이 안내만.
  if (action === 'regen-product') {
    return '🔄 상품이 틀리면 리젝 후 정확한 상품명을 다시 보내주세요 (자동 재검색은 같은 결과라 생략)';
  }

  // 텍스트 재생성: PENDING_APPROVAL → COPYWRITING → (재생성) → PENDING_APPROVAL
  if (action === 'regen-text') {
    // PENDING_APPROVAL(정상) 또는 COPYWRITING(이전에 눌러 멈춘 카드) 에서 재생성 허용
    if (post.state !== PostState.PENDING_APPROVAL && post.state !== PostState.COPYWRITING) {
      return `현재 상태(${post.state})에선 재생성 불가`;
    }
    if (post.state === PostState.PENDING_APPROVAL) {
      await prisma.post.update({ where: { id: postId }, data: { state: PostState.COPYWRITING } });
    }
    try {
      await regenerateCopyAndResend(postId);
      logger.info({ postId }, 'regen-text done · new approval card sent');
      return '📝 텍스트 재생성 완료 · 새 승인 카드 확인';
    } catch (err) {
      logger.error({ postId, err }, 'regen-text failed');
      // 실패 시 카드가 죽지 않게 PENDING_APPROVAL 복귀
      await prisma.post
        .update({ where: { id: postId }, data: { state: PostState.PENDING_APPROVAL } })
        .catch(() => {});
      return `⚠ 텍스트 재생성 실패: ${(err as Error).message}`;
    }
  }

  // approve · reject
  const nextState = action === 'approve' ? PostState.APPROVED : PostState.REJECTED;
  if (post.state === nextState) {
    return `이미 ${nextState} 상태`;
  }
  // 이미 승인·발행 단계면 리젝 불가 (상태머신 예외 대신 친절한 안내)
  if (
    action === 'reject' &&
    (post.state === PostState.APPROVED || post.state === PostState.PUBLISHING || post.state === PostState.PUBLISHED)
  ) {
    return '⚠ 이미 승인·발행 단계라 리젝 불가 (필요하면 Threads 에서 직접 삭제하세요)';
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

  // 텔레그램 수동 승인 = 즉시 발행 (사용자님이 지금 발행하려고 승인한 것).
  // 자동 크론(shopping-publisher)만 계정 시차 스케줄 적용.
  let scheduleNote = '';
  if (action === 'approve') {
    try {
      await prisma.post.update({ where: { id: postId }, data: { scheduledAt: new Date() } });
      await publishQueue.add('publish', { postId }, { jobId: `publish-${postId}` });
      scheduleNote = ' · 즉시 발행';
    } catch (err) {
      logger.error({ postId, err }, 'immediate publish enqueue failed');
      scheduleNote = ` ⚠ 발행 큐 실패: ${(err as Error).message}`;
    }
  }

  return action === 'approve' ? '✅ 승인' + scheduleNote : '🗑 폐기 처리';
}
