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
  if (!classified.suitable || !classified.searchKeyword) {
    return finishRejected(post.id, 'classifier', classified.reason ?? 'not suitable');
  }

  // 5. State transition → MATCHING
  await transitionPost(post.id, PostState.CLASSIFYING, PostState.MATCHING);

  // 6. Product Matcher — explicit URL 있으면 스킵, 없으면 자동 매칭
  let matchedResult: MatchResult;
  if (input.explicitCommerceUrl) {
    logger.info(
      { postId: post.id, explicitCommerceUrl: input.explicitCommerceUrl },
      'pipeline-a: skipping matcher, using explicit commerce URL',
    );
    matchedResult = await buildExplicitMatch(input.explicitCommerceUrl, classified);
  } else {
    logger.info({ postId: post.id, keyword: classified.searchKeyword }, 'pipeline-a: matching');
    const matched = await matchProduct({
      category: classified.category ?? '생활용품',
      searchKeyword: classified.searchKeyword,
      sourceImageUrl: firstImageForVision,
      maxAttempts: 3,
    });
    if (!matched.success) {
      return finishRejected(post.id, 'matcher', matched.reason);
    }
    matchedResult = matched.result;
  }
  const matched = { success: true as const, result: matchedResult };

  // 7. CommerceProduct upsert
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

  // 8. Media Handler — Cloudinary 업로드 (2개 이상 하드 룰)
  logger.info({ postId: post.id }, 'pipeline-a: media upload');
  const media = await handleMedia({
    postId: post.id,
    sourceMediaUrls: input.sourceMediaUrls,
  });

  // 9. State transition → COPYWRITING
  await transitionPost(post.id, PostState.MATCHING, PostState.COPYWRITING);

  // 10. Copywriter
  logger.info({ postId: post.id }, 'pipeline-a: copywriting');
  const copy = await generateCopy({
    sourceText: input.sourceText,
    // 이미지 없으면 텍스트만으로 카피 생성 (Vision 은 비디오 URL 처리 못함)
    sourceImageUrl: imageOnlyUrls[0],
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
  if (channel === 'COUPANG') {
    const coupang = new CoupangAdapter(env.COUPANG_ACCESS_KEY ?? '', env.COUPANG_SECRET_KEY ?? '');
    deeplinkUrl = await coupang.generateDeeplink(commerceUrl);
  }
  // MUSINSA · NAVER: 딥링크 API 없음 → 원본 URL 그대로 사용

  const productIdMatch = commerceUrl.match(/\/products\/(\d+)/);
  const externalId = productIdMatch?.[1] ?? `manual-${createHash('sha256').update(commerceUrl).digest('hex').slice(0, 16)}`;
  const productName = classified.searchKeyword ?? '사용자 지정 상품';

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
