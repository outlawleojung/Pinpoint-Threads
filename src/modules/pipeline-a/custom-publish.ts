import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { PostKind, PostState, InboundSource, InboundStatus } from '@prisma/client';
import { ingestUrl } from '../shared/url-ingester/index.js';
import { handleMedia, uploadFromUrl } from '../shared/media-handler/index.js';
import { generateCustomBody } from '../shared/copywriter/index.js';
import { sendApprovalRequest } from '../shared/approval-gate/service.js';
import { CoupangAdapter } from '../../infra/commerce/coupang-client.js';
import { env } from '../../config/env.js';

/**
 * 커스텀 발행 — 사용자가 텔레그램으로 소스 URL + 카피 방향(+커머스 링크)을 직접 지정한 글.
 *   - 소스에서 미디어 확보(2장 룰: 영상뿐이면 프레임 1장 추가)
 *   - generateCustomBody 로 "방향"대로 본문(+고정댓글 리드) 생성
 *   - 커머스 링크는 파트너스 딥링크로 자동 변환 → 고정댓글 + 공정위 문구
 *   - 승인 카드 발송
 */

const isVideoUrl = (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');

function videoToJpgThumb(u: string): string {
  if (!(u.includes('res.cloudinary.com') && u.includes('/video/upload/'))) return u;
  let out = u.replace('/video/upload/', '/video/upload/w_720,q_auto,so_auto/');
  out = out.replace(/\.(mp4|mov|webm)(\?|$)/i, '.jpg$2');
  if (!/\.jpg(?:\?|$)/i.test(out)) out += '.jpg';
  return out;
}

function disclaimerFor(channel: 'COUPANG' | 'MUSINSA' | 'NAVER'): string {
  if (channel === 'MUSINSA') return '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
  if (channel === 'NAVER') return '이 포스팅은 네이버 쇼핑 제휴 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
  return '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
}

/** 커머스 URL → 파트너스 딥링크(+채널). 쿠팡만 API 변환, 무신사·네이버는 원본 유지. */
async function toDeeplink(commerceUrl: string): Promise<{ deeplink: string; channel: 'COUPANG' | 'MUSINSA' | 'NAVER' }> {
  const { detectCommerceChannel } = await import('../shared/url-ingester/platform-detector.js');
  const channel = (detectCommerceChannel(commerceUrl) ?? 'COUPANG') as 'COUPANG' | 'MUSINSA' | 'NAVER';
  if (channel === 'COUPANG' && !/link\.coupang\.com\/a\//i.test(commerceUrl)) {
    const coupang = new CoupangAdapter(env.COUPANG_ACCESS_KEY ?? '', env.COUPANG_SECRET_KEY ?? '');
    const deeplink = await coupang.generateDeeplink(commerceUrl);
    return { deeplink, channel };
  }
  return { deeplink: commerceUrl, channel };
}

export interface RunCustomPublishInput {
  accountId: string;
  sourceUrl: string;
  direction: string; // 사용자가 준 카피 방향
  commerceUrl?: string; // 있으면 고정댓글 링크
  hasVideo?: boolean;
}

export type CustomPublishOutcome =
  | { status: 'PENDING_APPROVAL'; postId: string; body: string }
  | { status: 'FAILED'; stage: string; reason: string; postId?: string };

export async function runCustomPublish(input: RunCustomPublishInput): Promise<CustomPublishOutcome> {
  const account = await prisma.account.findUnique({
    where: { id: input.accountId },
    select: { id: true, handle: true, isActive: true, personaPrompt: true },
  });
  if (!account) return { status: 'FAILED', stage: 'account', reason: 'account not found' };
  if (!account.isActive) return { status: 'FAILED', stage: 'account', reason: 'account inactive' };

  // 1) 커머스 링크 딥링크 변환 먼저 (실패하면 미디어 작업 전에 중단)
  let deeplink: string | undefined;
  let channel: 'COUPANG' | 'MUSINSA' | 'NAVER' | undefined;
  if (input.commerceUrl) {
    try {
      const r = await toDeeplink(input.commerceUrl);
      deeplink = r.deeplink;
      channel = r.channel;
    } catch (err) {
      return {
        status: 'FAILED',
        stage: 'deeplink',
        reason: `커머스 링크 딥링크 변환 실패 (${(err as Error).message}). 상품 페이지에서 "공유 → 파트너스 링크"로 만든 link.coupang.com/a/... 를 보내주세요.`,
      };
    }
  }

  // 2) 소스 인제스트 (벤치마크 승격 X)
  const ing = await ingestUrl({ url: input.sourceUrl, source: InboundSource.MANUAL_TELEGRAM, skipPromote: true });
  if (ing.status !== InboundStatus.FETCHED) return { status: 'FAILED', stage: 'ingest', reason: ing.message };
  const inbound = await prisma.inboundLink.findUnique({
    where: { id: ing.inboundLinkId },
    select: { mediaUrls: true, rawText: true, rawLanguage: true, url: true },
  });
  if (!inbound) return { status: 'FAILED', stage: 'ingest', reason: 'inbound not found' };

  const rawMedia = inbound.mediaUrls ?? [];
  const hasCoverFrame = rawMedia.some((u) => u.includes('video_default_cover_frame') || /\/t51\.71878-15\//.test(u));
  const effectiveHasVideo = input.hasVideo ?? (hasCoverFrame ? true : undefined);
  const { ensureBenchmarkVideo } = await import('./video-rescue.js');
  const sourceMedia = await ensureBenchmarkVideo(null, inbound.url, rawMedia, effectiveHasVideo);
  if (sourceMedia.length === 0) return { status: 'FAILED', stage: 'media', reason: '소스에 미디어가 없음' };

  const post = await prisma.post.create({
    data: {
      state: PostState.COPYWRITING,
      kind: input.commerceUrl ? PostKind.SHOPPING : PostKind.DAILY,
      accountId: account.id,
      sourceMediaUrls: sourceMedia,
    },
  });

  try {
    // 3) 미디어 2장 확보 (영상뿐이면 프레임 JPG 1장 추가)
    let publicUrls: string[];
    if (sourceMedia.length >= 2) {
      publicUrls = (await handleMedia({ postId: post.id, sourceMediaUrls: sourceMedia })).publicUrls;
    } else if (isVideoUrl(sourceMedia[0]!)) {
      const up = await uploadFromUrl({ sourceUrl: sourceMedia[0]!, postId: post.id, resourceType: 'video' });
      const frameDeliveryUrl = videoToJpgThumb(up.publicUrl);
      let framePublic: string;
      try {
        framePublic = (await uploadFromUrl({ sourceUrl: frameDeliveryUrl, postId: post.id, resourceType: 'image' })).publicUrl;
      } catch {
        framePublic = frameDeliveryUrl;
      }
      publicUrls = [up.publicUrl, framePublic];
    } else {
      return await finishFailed(post.id, 'media', '이미지 1장만 있음 · 발행은 2장 이상 필요 (영상이면 자동 캡처 추가)');
    }

    // 4) 카피 (방향대로) + 고정댓글 리드
    const rawText = (inbound.rawText ?? '').trim();
    const gen = await generateCustomBody({
      direction: input.direction,
      personaPrompt: account.personaPrompt,
      accountSeed: account.id,
      accountId: account.id,
      sourceText: rawText || undefined,
      sourceLanguage: inbound.rawLanguage,
      withReplyLead: Boolean(deeplink),
    });

    // 5) 고정댓글 조립 (딥링크 + 공정위 문구)
    let generatedReply: string | undefined;
    if (deeplink && channel) {
      const lead = (gen.replyLead ?? '').trim() || '자세한 건 여기서 확인해봐';
      generatedReply = `[광고] ${lead}\n${deeplink}\n\n${disclaimerFor(channel)}`;
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        mediaUrl: publicUrls[0],
        mediaUrls: publicUrls,
        generatedBody: gen.body,
        generatedReply,
      },
    });

    await sendApprovalRequest(post.id);
    logger.info({ postId: post.id, handle: account.handle, hasReply: Boolean(generatedReply) }, '커스텀 발행 승인 카드 발송');
    return { status: 'PENDING_APPROVAL', postId: post.id, body: gen.body };
  } catch (err) {
    return await finishFailed(post.id, 'custom-publish', (err as Error).message);
  }
}

async function finishFailed(postId: string, stage: string, reason: string): Promise<CustomPublishOutcome> {
  await prisma.post
    .update({ where: { id: postId }, data: { state: PostState.FAILED, rejectionReason: `${stage}: ${reason}`.slice(0, 500) } })
    .catch(() => {});
  logger.warn({ postId, stage, reason }, '커스텀 발행 failed');
  return { status: 'FAILED', stage, reason, postId };
}
