import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { PostKind, PostState } from '@prisma/client';
import { handleMedia } from '../../shared/media-handler/index.js';
import { generateCurationBody } from '../../shared/copywriter/index.js';
import { composeCurationReply } from '../reply-composer/index.js';
import { sendApprovalRequest } from '../../shared/approval-gate/service.js';
import { selectLineBSet } from './product-selector.js';

/**
 * Line B (상품 우선) 오케스트레이터.
 *
 * 사용자 URL 없이: 쿠팡 베스트셀러 → 미니 세트(2~3) → 미디어(API 썸네일) → 큐레이션 카피
 *   → 고정댓글 딥링크 → 승인 카드. 사용자님은 승인/리젝만.
 *
 * Line A(사용자 URL 벤치마크)와 별도 라인. 다운스트림(승인·발행·성과)은 공용 인프라 재사용.
 */

const PER_ACCOUNT_DAILY_MAX = 2; // 계정당 하루 쇼핑 발행 상한 (A+B 합산)

export interface LineBResult {
  status: 'sent_for_approval' | 'skipped_daily_cap' | 'skipped_no_candidate' | 'failed';
  postId?: string;
  usedExternalIds?: string[];
  categoryKr?: string;
  body?: string;
  reason?: string;
}

export async function runLineBForAccount(
  accountId: string,
  excludeExternalIds: string[] = [],
): Promise<LineBResult> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { id: true, handle: true, isActive: true, personaPrompt: true, audienceGender: true },
  });
  if (!account.isActive) return { status: 'failed', reason: 'account inactive' };

  // 하루 상한 (A+B 합산 SHOPPING)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = await prisma.post.count({
    where: {
      accountId,
      kind: PostKind.SHOPPING,
      createdAt: { gte: todayStart },
      state: { notIn: [PostState.REJECTED, PostState.FAILED] },
    },
  });
  if (todayCount >= PER_ACCOUNT_DAILY_MAX) {
    return { status: 'skipped_daily_cap', reason: `이미 오늘 ${todayCount}건 (cap=${PER_ACCOUNT_DAILY_MAX})` };
  }

  const set = await selectLineBSet(accountId, excludeExternalIds);
  if (!set || set.products.length < 2) {
    return { status: 'skipped_no_candidate', reason: 'Line B 미니 세트 후보 없음' };
  }
  const usedExternalIds = set.products.map((p) => p.externalId);
  const representative = set.products[0]!;

  // Post 초안 (SHOPPING · COPYWRITING). sourceItem 없음(상품 우선 라인).
  const post = await prisma.post.create({
    data: {
      state: PostState.COPYWRITING,
      kind: PostKind.SHOPPING,
      accountId: account.id,
      sourceMediaUrls: set.products.map((p) => p.thumbnailUrl),
    },
  });

  try {
    // 미디어: 상품 썸네일들 → Cloudinary 미러 (2+ 하드룰은 handleMedia 가 검증)
    const media = await handleMedia({
      postId: post.id,
      sourceMediaUrls: set.products.map((p) => p.thumbnailUrl),
    });

    // 큐레이션 카피 (친구톤, 판매톤 X)
    const body = await generateCurationBody({
      personaPrompt: account.personaPrompt,
      accountSeed: account.id,
      accountId: account.id,
      categoryKr: set.categoryKr,
      productNames: set.products.map((p) => p.productName),
    });

    // 고정댓글: 기존 형식([광고] 리드 + 마스킹 링크 + 공정위) · 멀티링크 버전
    const reply = await composeCurationReply({
      body,
      categoryKr: set.categoryKr,
      items: set.products.map((p) => ({ name: p.productName, deeplinkUrl: p.deeplinkUrl })),
      accountId: account.id,
      personaPrompt: account.personaPrompt,
      channel: 'COUPANG',
    });

    // 대표 상품 CommerceProduct upsert (카드 썸네일·성과 추적 앵커)
    const product = await prisma.commerceProduct.upsert({
      where: { channel_externalId: { channel: 'COUPANG', externalId: representative.externalId } },
      update: {
        productName: representative.productName,
        productUrl: representative.productUrl,
        deeplinkUrl: representative.deeplinkUrl,
        thumbnailUrl: representative.thumbnailUrl,
        price: representative.price,
        category: representative.categoryKr,
      },
      create: {
        channel: 'COUPANG',
        externalId: representative.externalId,
        productName: representative.productName,
        productUrl: representative.productUrl,
        deeplinkUrl: representative.deeplinkUrl,
        thumbnailUrl: representative.thumbnailUrl,
        price: representative.price,
        category: representative.categoryKr,
      },
    });

    await prisma.post.update({
      where: { id: post.id },
      data: {
        commerceProductId: product.id,
        mediaUrl: media.publicUrls[0],
        mediaUrls: media.publicUrls,
        generatedBody: body,
        generatedReply: reply.text,
      },
    });

    await sendApprovalRequest(post.id);
    logger.info(
      { postId: post.id, handle: account.handle, categoryKr: set.categoryKr, count: set.products.length },
      'Line B card sent for approval',
    );
    return {
      status: 'sent_for_approval',
      postId: post.id,
      usedExternalIds,
      categoryKr: set.categoryKr,
      body,
    };
  } catch (err) {
    await prisma.post
      .update({
        where: { id: post.id },
        data: { state: PostState.FAILED, rejectionReason: `line-b: ${(err as Error).message}`.slice(0, 500) },
      })
      .catch(() => {});
    logger.error({ err, postId: post.id, accountId }, 'Line B failed');
    return { status: 'failed', postId: post.id, reason: (err as Error).message };
  }
}

export interface LineBBatchSummary {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  perAccount: Array<{ handle: string; result: LineBResult }>;
}

/**
 * 전 계정 Line B 실행. 계정 간 상품 dedup (같은 상품 동시 배포 방지).
 */
export async function runLineBForAllAccounts(): Promise<LineBBatchSummary> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, handle: true },
    orderBy: { handle: 'asc' },
  });
  const summary: LineBBatchSummary = { total: accounts.length, sent: 0, skipped: 0, failed: 0, perAccount: [] };
  const usedExternalIds = new Set<string>();

  for (const acc of accounts) {
    try {
      const result = await runLineBForAccount(acc.id, Array.from(usedExternalIds));
      for (const id of result.usedExternalIds ?? []) usedExternalIds.add(id);
      summary.perAccount.push({ handle: acc.handle, result });
      if (result.status === 'sent_for_approval') summary.sent += 1;
      else if (result.status.startsWith('skipped_')) summary.skipped += 1;
      else summary.failed += 1;
    } catch (err) {
      logger.error({ err, accountId: acc.id }, 'Line B batch crashed for account');
      summary.perAccount.push({ handle: acc.handle, result: { status: 'failed', reason: (err as Error).message } });
      summary.failed += 1;
    }
  }
  logger.info({ summary }, 'Line B batch done');
  return summary;
}
