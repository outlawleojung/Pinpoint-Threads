import { PostState } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { classifySourceItem } from '../shared/content-classifier/index.js';
import { matchProduct, type MatchResult } from './product-matcher/index.js';
import { CoupangAdapter } from '../../infra/commerce/coupang-client.js';
import { env } from '../../config/env.js';
import { handleMedia } from '../shared/media-handler/index.js';
import { generateCopy } from '../shared/copywriter/index.js';
import { composeReply } from './reply-composer/index.js';
import { sendApprovalRequest } from '../shared/approval-gate/service.js';
import { assertTransition } from '../../state/post-state-machine.js';

/**
 * Pipeline A Orchestrator — 소스 인풋을 받아 승인 카드까지 자동 진행.
 * Task #3h e2e 조립.
 *
 * 흐름:
 *   Source → Classifier → Product Matcher → Media Handler
 *          → Copywriter → Reply Composer → Post 저장 → Approval Gate
 */

export interface RunPipelineAInput {
  accountId: string;
  sourceMediaUrls: string[];   // 2개 이상 필수 (docs/01-pipelines/A-shopping.md § 5)
  sourceText: string;
  sourceUrl?: string;
  language?: string;
  /**
   * 사용자가 텔레그램에 벤치마크 URL 과 함께 붙여준 실제 상품 URL (Coupang 등).
   * 존재하면 Product Matcher/Vision 스킵 · 이 URL 을 Deeplink API 로 파트너스 링크로 변환해 사용.
   * Coupang search 브랜드 매칭 실패 우회.
   */
  explicitCommerceUrl?: string;
  /**
   * 사용자가 텔레그램에 벤치마크 URL 과 함께 붙여준 **상품명(텍스트)**.
   * 존재하면 Classifier 의 searchKeyword 대신 이 상품명으로 쿠팡 검색 → Vision 으로 best 후보 선택.
   * 텔레그램이 쿠팡 링크를 차단하므로, 링크 아닌 상품명으로 매칭 (docs/08-decisions/manual-shopping-flow.md).
   */
  productNameHint?: string;
}

export type PipelineAOutcome =
  | {
      status: 'PENDING_APPROVAL';
      postId: string;
      matchedProductName: string;
      visionScore: number;
      body: string;
      replyText: string;
      replyLead: string;
    }
  | { status: 'REJECTED'; stage: string; reason: string; postId?: string };

export async function runPipelineA(input: RunPipelineAInput): Promise<PipelineAOutcome> {
  const trace = { accountId: input.accountId, mediaCount: input.sourceMediaUrls.length };
  logger.info(trace, 'pipeline-a start');

  // 1. Account fetch
  const account = await prisma.account.findUnique({ where: { id: input.accountId } });
  if (!account) return { status: 'REJECTED', stage: 'account', reason: 'account not found' };

  // 2. SourceItem 생성/재사용 (dedup: sourceUrl 우선 · 없으면 contentHash)
  //    sourceUrl 이 있으면 그 URL 당 SourceItem 1개 유지 (mediaUrls 는 후속 재추출로 바뀔 수 있어
  //    contentHash 만으로 upsert 하면 sourceUrl UNIQUE 제약 위반).
  const contentHash = createHash('sha256')
    .update((input.sourceUrl ?? '') + '|' + input.sourceMediaUrls.join(','))
    .digest('hex');
  const source = input.sourceUrl
    ? await prisma.sourceItem.upsert({
        where: { sourceUrl: input.sourceUrl },
        update: {},
        create: {
          sourceUrl: input.sourceUrl,
          contentHash,
          rawText: input.sourceText,
          mediaUrls: input.sourceMediaUrls,
          language: input.language,
        },
      })
    : await prisma.sourceItem.upsert({
        where: { contentHash },
        update: {},
        create: {
          sourceUrl: `manual://${contentHash.slice(0, 12)}`,
          contentHash,
          rawText: input.sourceText,
          mediaUrls: input.sourceMediaUrls,
          language: input.language,
        },
      });

  // 3. Post draft
  let post = await prisma.post.create({
    data: {
      state: PostState.CLASSIFYING,
      accountId: account.id,
      sourceItemId: source.id,
      sourceMediaUrls: input.sourceMediaUrls,
    },
  });

  // 4. Content Classifier · Vision 모듈들은 이미지만 처리 가능 (mp4 X)
  const isVideoUrl = (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');
  const imageOnlyUrls = input.sourceMediaUrls.filter((u) => !isVideoUrl(u));
  // 비디오 전용 벤치마크: Cloudinary /video/upload/ 를 JPG 썸네일로 변환
  const videoToJpgThumb = (u: string): string =>
    u.includes('res.cloudinary.com') && u.includes('/video/upload/')
      ? u.replace('/video/upload/', '/video/upload/w_720,q_auto,so_0/').replace(/\.mp4(\?|$)/i, '.jpg$1')
      : u;
  const firstImageForVision = imageOnlyUrls[0]
    ?? (input.sourceMediaUrls[0] ? videoToJpgThumb(input.sourceMediaUrls[0]) : undefined) as string;

  logger.info({ postId: post.id }, 'pipeline-a: classifying');
  // Anthropic Vision 은 이미지만 처리 · 비디오 URL 은 실패 → 이미지 없으면 텍스트만으로 분류
  const classified = await classifySourceItem({
    text: input.sourceText,
    mediaUrls: imageOnlyUrls, // 비어있으면 텍스트만
  });
  // 상품명 힌트가 있으면 classifier searchKeyword 없어도 진행 (사용자가 상품 확정)
  if (!input.productNameHint && (!classified.suitable || !classified.searchKeyword)) {
    return finishRejected(post.id, 'classifier', classified.reason ?? 'not suitable');
  }

  // 5. State transition → MATCHING
  await transitionPost(post.id, PostState.CLASSIFYING, PostState.MATCHING);

  // 미디어 미러부터 이후 단계에서 예외가 나면 포스트를 FAILED 로 종결.
  // (안 하면 MATCHING/COPYWRITING 에 방치돼 그 계정 하루 발행 소진 + 벤치마크 14일 블랙리스트)
  try {
  // 6. Media Handler — Cloudinary 미러를 **매칭보다 먼저**.
  //   원본 IG/Threads CDN(~10분) 이 매칭(최대 3회 Vision) 도중 만료돼 업로드 실패하는 것을 방지 + 2개 이상 하드룰 조기 검증.
  logger.info({ postId: post.id }, 'pipeline-a: media upload (pre-match)');
  const media = await handleMedia({
    postId: post.id,
    sourceMediaUrls: input.sourceMediaUrls,
  });
  // 이후 Vision·카피는 영구 Cloudinary 이미지를 사용 (원본 만료 무관)
  const uploadedImageForVision = media.publicUrls.find((u) => !isVideoUrl(u))
    ?? (media.publicUrls[0] ? videoToJpgThumb(media.publicUrls[0]) : firstImageForVision);

  // 7. Product Matcher
  //   - explicitCommerceUrl 있으면: 그 URL 로 딥링크 (Matcher/Vision 스킵)
  //   - productNameHint 있으면: 사용자 상품명으로 검색 → best 후보 선택
  //   - 둘 다 없으면: classifier searchKeyword 자동 매칭
  let matchedResult: MatchResult;
  if (input.explicitCommerceUrl) {
    logger.info(
      { postId: post.id, explicitCommerceUrl: input.explicitCommerceUrl },
      'pipeline-a: skipping matcher, using explicit commerce URL',
    );
    matchedResult = await buildExplicitMatch(input.explicitCommerceUrl, classified);
  } else {
    const searchKeyword = input.productNameHint ?? classified.searchKeyword!;
    logger.info(
      { postId: post.id, keyword: searchKeyword, fromHint: !!input.productNameHint },
      'pipeline-a: matching',
    );
    const matchedOutcome = await matchProduct({
      category: classified.category ?? '생활용품',
      searchKeyword,
      sourceImageUrl: uploadedImageForVision,
      maxAttempts: 3,
      trustKeyword: !!input.productNameHint, // 사용자 상품명이면 best 후보 신뢰
    });
    if (!matchedOutcome.success) {
      return finishRejected(post.id, 'matcher', matchedOutcome.reason);
    }
    matchedResult = matchedOutcome.result;
  }
  const matched = { success: true as const, result: matchedResult };

  // 8. CommerceProduct upsert
  const product = await prisma.commerceProduct.upsert({
    where: {
      channel_externalId: {
        channel: matched.result.channel,
        externalId: matched.result.product.externalId,
      },
    },
    update: {
      productName: matched.result.product.productName,
      productUrl: matched.result.product.productUrl,
      deeplinkUrl: matched.result.deeplinkUrl,
      thumbnailUrl: matched.result.product.thumbnailUrl,
      price: matched.result.product.price ?? null,
      category: matched.result.product.category ?? classified.category ?? null,
    },
    create: {
      channel: matched.result.channel,
      externalId: matched.result.product.externalId,
      productName: matched.result.product.productName,
      productUrl: matched.result.product.productUrl,
      deeplinkUrl: matched.result.deeplinkUrl,
      thumbnailUrl: matched.result.product.thumbnailUrl,
      price: matched.result.product.price ?? null,
      category: matched.result.product.category ?? classified.category ?? null,
    },
  });

  // 9. State transition → COPYWRITING
  await transitionPost(post.id, PostState.MATCHING, PostState.COPYWRITING);

  // 10. Copywriter
  logger.info({ postId: post.id }, 'pipeline-a: copywriting');
  const copy = await generateCopy({
    sourceText: input.sourceText,
    // 영구 Cloudinary 이미지 사용 (원본 만료 무관 · 없으면 undefined → 텍스트만)
    sourceImageUrl: uploadedImageForVision && !isVideoUrl(uploadedImageForVision) ? uploadedImageForVision : undefined,
    productName: matched.result.product.productName,
    productCategory: matched.result.product.category ?? classified.category,
    accountSeed: account.id,
    accountId: account.id,
    personaPrompt: account.personaPrompt,
    deeplinkUrl: matched.result.deeplinkUrl,
    channel: matched.result.channel,
    ragEnabled: true,
    factCheckEnabled: true,
  });

  // 11. Reply Composer (AI 기반 감초 톤 리드 생성)
  const reply = await composeReply({
    body: copy.body,
    productName: matched.result.product.productName,
    productCategory: matched.result.product.category ?? classified.category,
    deeplinkUrl: matched.result.deeplinkUrl,
    accountId: account.id,
    personaPrompt: account.personaPrompt,
    channel: matched.result.channel,
  });

  // 12. Post 업데이트 (모든 필드 채워짐)
  post = await prisma.post.update({
    where: { id: post.id },
    data: {
      commerceProductId: product.id,
      mediaUrl: media.publicUrls[0],   // 하위 호환용 첫 URL
      mediaUrls: media.publicUrls,
      generatedBody: copy.body,
      generatedReply: reply.text,
      visionMatchScore: matched.result.visionScore,
    },
  });

  // 13. Approval Gate — sendApprovalRequest 안에서 state → PENDING_APPROVAL 전이
  logger.info({ postId: post.id }, 'pipeline-a: sending approval');
  await sendApprovalRequest(post.id);

  return {
    status: 'PENDING_APPROVAL',
    postId: post.id,
    matchedProductName: matched.result.product.productName,
    visionScore: matched.result.visionScore,
    body: copy.body,
    replyText: reply.text,
    replyLead: reply.lead,
  };
  } catch (err) {
    return finishFailed(post.id, 'post-match', err);
  }
}

/**
 * explicit commerce URL 이 주어졌을 때 MatchResult 를 조립.
 *   - Coupang Deeplink API 로 사용자 원본 URL → 파트너스 딥링크 변환 (핵심 · 커미션 위해 필수)
 *   - Product 메타 (name, category, thumbnail) 는 Content Classifier 결과·source text 로 채움
 *   - Vision 스킵 (사용자가 이미 확정한 URL)
 */
async function buildExplicitMatch(
  commerceUrl: string,
  classified: { category?: string | null; searchKeyword?: string | null },
): Promise<MatchResult> {
  const { detectCommerceChannel } = await import('../shared/url-ingester/platform-detector.js');
  const channel = detectCommerceChannel(commerceUrl) ?? 'COUPANG';

  let deeplinkUrl = commerceUrl;
  // 이미 완성된 파트너스 딥링크 (link.coupang.com/a/...) 이면 재생성 X · 그대로 사용
  const isAlreadyDeeplink = /link\.coupang\.com\/a\//i.test(commerceUrl);
  if (channel === 'COUPANG' && !isAlreadyDeeplink) {
    const coupang = new CoupangAdapter(env.COUPANG_ACCESS_KEY ?? '', env.COUPANG_SECRET_KEY ?? '');
    try {
      deeplinkUrl = await coupang.generateDeeplink(commerceUrl);
    } catch (err) {
      // 축약 URL (itemId 없는 /products/id) 은 쿠팡이 변환 거부 → 사용자님이 직접 만든 딥링크 필요
      throw new Error(
        `쿠팡 딥링크 변환 실패 (${(err as Error).message}). ` +
        `상품 페이지에서 "공유 → 파트너스 링크" 로 만든 link.coupang.com/a/... 링크를 보내주세요.`,
      );
    }
  }
  // MUSINSA · NAVER: 딥링크 API 없음 → 원본 URL 그대로 사용

  const productIdMatch = commerceUrl.match(/\/products\/(\d+)/);
  const externalId = productIdMatch?.[1] ?? `manual-${createHash('sha256').update(commerceUrl).digest('hex').slice(0, 16)}`;

  // 쿠팡 상품 제목 추출 (전체 특징 담김) → 카피 정합성. 쿠팡만 · 실패 시 검색어 fallback.
  let productName = classified.searchKeyword ?? '사용자 지정 상품';
  if (channel === 'COUPANG') {
    try {
      const { fetchCoupangProductTitle } = await import('../../infra/coupang-product-title.js');
      const title = await fetchCoupangProductTitle(commerceUrl);
      // 방어: 봇 차단 페이지 문구가 혹시 새어나와도 상품명으로 쓰지 않음
      if (title && !/access denied|접근이 거부|잠시 후 다시/i.test(title)) productName = title;
    } catch (err) {
      logger.warn({ err }, 'coupang title 추출 스킵 · 검색어 사용');
    }
  }

  return {
    channel,
    product: {
      channel,
      externalId,
      productName,
      productUrl: commerceUrl,
      thumbnailUrl: '',
      category: classified.category ?? undefined,
    },
    visionScore: 1.0,
    attempts: 0,
    deeplinkUrl,
  };
}

async function transitionPost(postId: string, from: PostState, to: PostState) {
  assertTransition(from, to);
  await prisma.post.update({ where: { id: postId }, data: { state: to } });
}

async function finishRejected(postId: string, stage: string, reason: string): Promise<PipelineAOutcome> {
  await prisma.post.update({
    where: { id: postId },
    data: { state: PostState.REJECTED, rejectionReason: `${stage}: ${reason}` },
  });
  logger.warn({ postId, stage, reason }, 'pipeline-a rejected');
  return { status: 'REJECTED', stage, reason, postId };
}

/**
 * 매칭 이후 단계에서 예외 발생 시 포스트를 FAILED 로 종결.
 * FAILED 는 todayCount·벤치마크 dedup 에서 제외되므로 계정 발행 소진·블랙리스트를 유발하지 않고,
 * 상태머신상 재시도(CLASSIFYING/MATCHING/COPYWRITING/PUBLISHING) 도 가능.
 */
async function finishFailed(postId: string, stage: string, err: unknown): Promise<PipelineAOutcome> {
  const reason = String((err as Error)?.message ?? err).slice(0, 500);
  await prisma.post.update({
    where: { id: postId },
    data: { state: PostState.FAILED, rejectionReason: `${stage}: ${reason}` },
  }).catch(() => {});
  logger.error({ postId, stage, err }, 'pipeline-a failed (post-match) → FAILED');
  return { status: 'REJECTED', stage, reason, postId };
}
