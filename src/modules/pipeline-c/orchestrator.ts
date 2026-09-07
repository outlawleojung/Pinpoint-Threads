import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { PostKind, PostState, InboundSource, InboundStatus } from '@prisma/client';
import { ingestUrl } from '../shared/url-ingester/index.js';
import { handleMedia, uploadFromUrl } from '../shared/media-handler/index.js';
import { generateDailyBody } from '../shared/copywriter/index.js';
import { sendApprovalRequest } from '../shared/approval-gate/service.js';

/**
 * Pipeline C — 일상글 (엔게이지먼트).
 *
 * 사용자가 "일상 {URL}" 태그로 던진 소스(귀여운 동물·공감 콘텐츠 등)를
 *   → 페르소나 톤 일상 공감 글로 각색 → 승인 카드 → 발행.
 * 상품 매칭·커머스 링크·고정댓글 **없음**. 쇼핑 벤치마크 풀도 오염 안 시킴(skipPromote).
 *
 * 미디어 룰: 2장 이상. 소스가 영상 1개뿐이면 **프레임 캡처 JPG 1장을 추가**해 2장으로 (사용자 방침).
 */

const isVideoUrl = (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');

/** Cloudinary 영상 URL → 첫 프레임 JPG 변환 URL (미디어 2장 충족용 캡처). */
function videoToJpgThumb(u: string): string {
  if (!(u.includes('res.cloudinary.com') && u.includes('/video/upload/'))) return u;
  // so_auto = Cloudinary가 가장 대표적인 프레임 자동 선택 (so_0 은 인트로·블랙 화면이 잦음)
  let out = u.replace('/video/upload/', '/video/upload/w_720,q_auto,so_auto/');
  out = out.replace(/\.(mp4|mov|webm)(\?|$)/i, '.jpg$2');
  if (!/\.jpg(?:\?|$)/i.test(out)) out += '.jpg';
  return out;
}

export interface RunPipelineCInput {
  accountId: string;
  sourceUrl: string;
}

export type PipelineCOutcome =
  | { status: 'PENDING_APPROVAL'; postId: string; body: string }
  | { status: 'FAILED'; stage: string; reason: string; postId?: string };

export async function runPipelineC(input: RunPipelineCInput): Promise<PipelineCOutcome> {
  const account = await prisma.account.findUnique({
    where: { id: input.accountId },
    select: { id: true, handle: true, isActive: true, personaPrompt: true },
  });
  if (!account) return { status: 'FAILED', stage: 'account', reason: 'account not found' };
  if (!account.isActive) return { status: 'FAILED', stage: 'account', reason: 'account inactive' };

  // 1) 소스 인제스트 (벤치마크 승격 X — 일상글은 쇼핑 풀과 분리)
  const ing = await ingestUrl({
    url: input.sourceUrl,
    source: InboundSource.MANUAL_TELEGRAM,
    skipPromote: true,
  });
  if (ing.status !== InboundStatus.FETCHED) {
    return { status: 'FAILED', stage: 'ingest', reason: ing.message };
  }
  const inbound = await prisma.inboundLink.findUnique({
    where: { id: ing.inboundLinkId },
    select: { mediaUrls: true, rawText: true, rawLanguage: true, url: true },
  });
  if (!inbound) return { status: 'FAILED', stage: 'ingest', reason: 'inbound not found' };

  const sourceMedia = inbound.mediaUrls ?? [];
  if (sourceMedia.length === 0) {
    return { status: 'FAILED', stage: 'media', reason: '소스에 미디어가 없음' };
  }

  // 2) Post 초안 (DAILY)
  const post = await prisma.post.create({
    data: {
      state: PostState.COPYWRITING,
      kind: PostKind.DAILY,
      accountId: account.id,
      sourceMediaUrls: sourceMedia,
    },
  });

  try {
    // 3) 미디어 확보 (2장 이상). 영상 1개뿐이면 프레임 JPG 추가.
    let publicUrls: string[];
    if (sourceMedia.length >= 2) {
      publicUrls = (await handleMedia({ postId: post.id, sourceMediaUrls: sourceMedia })).publicUrls;
    } else if (isVideoUrl(sourceMedia[0]!)) {
      // 단일 영상 → 프레임 캡처 1장 추가로 2장 구성.
      const up = await uploadFromUrl({ sourceUrl: sourceMedia[0]!, postId: post.id, resourceType: 'video' });
      const frameDeliveryUrl = videoToJpgThumb(up.publicUrl); // /video/upload/.../so_0.jpg (전송 URL)
      // ⚠️ frameDeliveryUrl 은 여전히 경로에 /video/upload/ 가 있어 isVideoUrl 이 '비디오'로 오인.
      //    → 프레임 JPG 를 **진짜 이미지 에셋으로 재업로드**해 /image/upload/ URL 로 만든다.
      let framePublic: string;
      try {
        const frameAsset = await uploadFromUrl({ sourceUrl: frameDeliveryUrl, postId: post.id, resourceType: 'image' });
        framePublic = frameAsset.publicUrl;
      } catch (err) {
        logger.warn({ err, postId: post.id }, 'Pipeline C: 프레임 이미지 재업로드 실패 · 전송URL fallback');
        framePublic = frameDeliveryUrl;
      }
      publicUrls = [up.publicUrl, framePublic];
      logger.info({ postId: post.id, frameIsImage: !isVideoUrl(framePublic) }, 'Pipeline C: 단일 영상 → 프레임 이미지 1장 추가');
    } else {
      // 이미지 1장뿐 → 2장 룰 미충족 (사용자에게 알림)
      return await finishFailed(post.id, 'media', '이미지 1장만 있음 · 일상글은 2장 이상 필요 (영상이면 자동 캡처 추가됨)');
    }

    // 4) 일상 카피 (상품·링크 없음). Vision용 이미지 = 첫 이미지 or 영상 프레임.
    const imageForCopy = publicUrls.find((u) => !isVideoUrl(u));
    const body = await generateDailyBody({
      personaPrompt: account.personaPrompt,
      accountSeed: account.id,
      accountId: account.id,
      sourceText: inbound.rawText ?? undefined,
      sourceLanguage: inbound.rawLanguage,
      sourceImageUrl: imageForCopy,
    });

    // 5) Post 업데이트 — 고정댓글(generatedReply) 없음 → 발행부가 본문만 게시.
    await prisma.post.update({
      where: { id: post.id },
      data: {
        mediaUrl: publicUrls[0],
        mediaUrls: publicUrls,
        generatedBody: body,
      },
    });

    await sendApprovalRequest(post.id);
    logger.info({ postId: post.id, handle: account.handle }, 'Pipeline C 일상글 승인 카드 발송');
    return { status: 'PENDING_APPROVAL', postId: post.id, body };
  } catch (err) {
    return await finishFailed(post.id, 'post-media', (err as Error).message);
  }
}

async function finishFailed(postId: string, stage: string, reason: string): Promise<PipelineCOutcome> {
  await prisma.post
    .update({ where: { id: postId }, data: { state: PostState.FAILED, rejectionReason: `${stage}: ${reason}`.slice(0, 500) } })
    .catch(() => {});
  logger.warn({ postId, stage, reason }, 'Pipeline C failed');
  return { status: 'FAILED', stage, reason, postId };
}
