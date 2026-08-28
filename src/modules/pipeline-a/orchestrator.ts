import { PostState } from '@prisma/client';
import { createHash } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { classifySourceItem } from '../shared/content-classifier/index.js';
import { matchProduct } from './product-matcher/index.js';
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
}

export type PipelineAOutcome =
  | {
      status: 'PENDING_APPROVAL';
      postId: string;
      matchedProductName: string;
      visionScore: number;
      body: string;
      replyText: string;
      replyVariant: 1 | 2 | 3 | 4;
    }
  | { status: 'REJECTED'; stage: string; reason: string; postId?: string };

export async function runPipelineA(input: RunPipelineAInput): Promise<PipelineAOutcome> {
  const trace = { accountId: input.accountId, mediaCount: input.sourceMediaUrls.length };
  logger.info(trace, 'pipeline-a start');

  // 1. Account fetch
  const account = await prisma.account.findUnique({ where: { id: input.accountId } });
  if (!account) return { status: 'REJECTED', stage: 'account', reason: 'account not found' };

  // 2. SourceItem 생성 (dedup by contentHash)
  const contentHash = createHash('sha256')
    .update((input.sourceUrl ?? '') + '|' + input.sourceMediaUrls.join(','))
    .digest('hex');
  const source = await prisma.sourceItem.upsert({
    where: { contentHash },
    update: {},
    create: {
      sourceUrl: input.sourceUrl ?? `manual://${contentHash.slice(0, 12)}`,
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

  // 4. Content Classifier
  logger.info({ postId: post.id }, 'pipeline-a: classifying');
  const classified = await classifySourceItem({
    text: input.sourceText,
    mediaUrls: input.sourceMediaUrls,
  });
  if (!classified.suitable || !classified.searchKeyword) {
    return finishRejected(post.id, 'classifier', classified.reason ?? 'not suitable');
  }

  // 5. State transition → MATCHING
  await transitionPost(post.id, PostState.CLASSIFYING, PostState.MATCHING);

  // 6. Product Matcher
  logger.info({ postId: post.id, keyword: classified.searchKeyword }, 'pipeline-a: matching');
  const matched = await matchProduct({
    category: classified.category ?? '생활용품',
    searchKeyword: classified.searchKeyword,
    sourceImageUrl: input.sourceMediaUrls[0]!,
    maxAttempts: 3,
  });
  if (!matched.success) {
    return finishRejected(post.id, 'matcher', matched.reason);
  }

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
    sourceImageUrl: input.sourceMediaUrls[0]!,
    productName: matched.result.product.productName,
    productCategory: matched.result.product.category ?? classified.category,
    accountSeed: account.id,
    personaPrompt: account.personaPrompt,
    deeplinkUrl: matched.result.deeplinkUrl,
    channel: matched.result.channel,
  });

  // 11. Reply Composer
  const reply = composeReply({
    deeplinkUrl: matched.result.deeplinkUrl,
    productName: matched.result.product.productName,
    accountId: account.id,
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
      replyVariantUsed: reply.variantUsed,
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
    replyVariant: reply.variantUsed,
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
