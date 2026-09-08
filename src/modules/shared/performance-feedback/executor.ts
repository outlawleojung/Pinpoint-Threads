import { PostKind, PostState } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { generateCopy } from '../copywriter/index.js';
import { composeReply } from '../../pipeline-a/reply-composer/index.js';
import { sendApprovalRequest } from '../approval-gate/service.js';
import { planPropagation, type PropagationPlan } from './propagation-planner.js';

/**
 * Propagation Executor — 유닛 ③ 실행부.
 *
 * planPropagation 이 낸 계획을 받아, confirmed winner 의 상품/벤치마크를 적격 계정에
 * **계정별 카피 재생성**으로 승인 카드 생성 (5계정 동일 콘텐츠 금지 준수).
 *
 * - 동시 발행 폭주 방지: winner 당 하루 확산 계정 수 상한(MAX_PER_WINNER).
 * - 멱등: 14일 동일상품 dedup 이 이미 카드 생긴 계정을 다음 sweep 에서 제외 → 중복 방지.
 * - dryRun: 카드 생성 없이 계획만 반환.
 */

const MAX_PER_WINNER = 2;

export interface PropagationExecResult {
  winnerPostId: string;
  productName: string;
  created: Array<{ handle: string; postId: string; body: string }>;
  skipped: string[];
  errors: Array<{ handle: string; error: string }>;
}

async function executeOne(plan: PropagationPlan, dryRun: boolean): Promise<PropagationExecResult> {
  const result: PropagationExecResult = { winnerPostId: plan.winnerPostId, productName: plan.productName, created: [], skipped: [], errors: [] };

  const winner = await prisma.post.findUnique({
    where: { id: plan.winnerPostId },
    include: { commerceProduct: true, sourceItem: true },
  });
  if (!winner?.commerceProduct) {
    result.errors.push({ handle: '(winner)', error: '상품 정보 없음' });
    return result;
  }
  const cp = winner.commerceProduct;
  const channel = cp.channel as 'COUPANG' | 'MUSINSA' | 'NAVER';
  const category = cp.category ?? undefined;
  const deeplinkUrl = cp.deeplinkUrl ?? undefined;
  const isVideoUrl = (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');
  const uploadedImg = winner.mediaUrls.find((u) => !isVideoUrl(u));

  const eligible = plan.targets.filter((t) => t.eligible).slice(0, MAX_PER_WINNER);
  for (const t of plan.targets.filter((x) => x.eligible).slice(MAX_PER_WINNER)) {
    result.skipped.push(`${t.handle}(오늘 상한 초과 · 다음 sweep)`);
  }

  for (const t of eligible) {
    if (dryRun) {
      result.created.push({ handle: t.handle, postId: '(dry-run)', body: '(생성 안 함)' });
      continue;
    }
    try {
      const acc = await prisma.account.findUniqueOrThrow({ where: { id: t.accountId }, select: { id: true, personaPrompt: true } });
      const copy = await generateCopy({
        sourceText: winner.sourceItem?.rawText ?? '',
        sourceImageUrl: uploadedImg,
        productName: cp.productName,
        productCategory: category,
        accountSeed: acc.id,
        accountId: acc.id,
        personaPrompt: acc.personaPrompt,
        deeplinkUrl,
        channel,
        ragEnabled: true,
        factCheckEnabled: true,
      });
      const reply = await composeReply({
        sourceBrief: copy.sourceBrief,
        sourceText: winner.sourceItem?.rawText ?? '',
        body: copy.body, productName: cp.productName, productCategory: category,
        deeplinkUrl, accountId: acc.id, personaPrompt: acc.personaPrompt, channel,
      });
      const post = await prisma.post.create({
        data: {
          accountId: acc.id, kind: PostKind.SHOPPING, state: PostState.COPYWRITING,
          sourceItemId: winner.sourceItemId, commerceProductId: cp.id,
          sourceMediaUrls: winner.sourceMediaUrls, mediaUrl: winner.mediaUrls[0], mediaUrls: winner.mediaUrls,
          generatedBody: copy.body, generatedReply: reply.text, visionMatchScore: winner.visionMatchScore,
        },
      });
      await sendApprovalRequest(post.id);
      result.created.push({ handle: t.handle, postId: post.id, body: copy.body });
      logger.info({ winnerPostId: plan.winnerPostId, target: t.handle, postId: post.id }, 'propagation card created');
    } catch (err) {
      result.errors.push({ handle: t.handle, error: (err as Error).message });
      logger.error({ err, target: t.handle }, 'propagation execute failed');
    }
  }
  return result;
}

/**
 * 확산 sweep: 현재 confirmed winner 전부에 대해 실행.
 * 72h 스냅샷 수집 완료 후 트리거. dryRun 기본 false.
 */
export async function runPropagationSweep(opts: { dryRun?: boolean } = {}): Promise<PropagationExecResult[]> {
  const dryRun = opts.dryRun ?? false;
  const plans = await planPropagation();
  if (plans.length === 0) {
    logger.info('propagation sweep: confirmed winner 없음 → skip');
    return [];
  }
  const results: PropagationExecResult[] = [];
  for (const plan of plans) {
    results.push(await executeOne(plan, dryRun));
  }
  const totalCreated = results.reduce((a, r) => a + r.created.length, 0);
  logger.info({ plans: plans.length, totalCreated, dryRun }, 'propagation sweep done');
  return results;
}
