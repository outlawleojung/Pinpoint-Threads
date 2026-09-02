import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { generateSharingCopy } from '../sharing-copywriter/index.js';
import { sendApprovalRequest } from '../../shared/approval-gate/service.js';
import { PostKind, PostState } from '@prisma/client';

/**
 * Pipeline B 스하리 발행 오케스트레이터.
 *
 * 계정 하나에 대해:
 *   1) 스하리 카피 생성 (계정 페르소나 무관, SHARING 벤치마크 각색)
 *   2) 중복 방지 (24h 내 같은 계정 SHARING Post 있으면 skip)
 *   3) Post 저장 (kind=SHARING, sourceItemId=null, state=PENDING_APPROVAL)
 *   4) 텔레그램 승인 카드 전송
 *   5) 사용자 승인 → 기존 스케줄러가 발행
 */

export interface SharingRunInput {
  accountId: string;
  variantCount?: number; // 여러 후보 중 첫 번째 사용, 나머지는 로그
}

export interface SharingRunResult {
  status: 'sent_for_approval' | 'skipped_recent' | 'failed';
  postId?: string;
  body?: string;
  reason?: string;
}

/**
 * 최근 몇 시간 이내에 같은 계정 SHARING 포스트가 있으면 스킵 (하루 1건 제한).
 */
const DEDUP_WINDOW_HOURS = 20;

export async function runSharingPipeline(input: SharingRunInput): Promise<SharingRunResult> {
  const acc = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { id: true, handle: true, isActive: true },
  });
  if (!acc.isActive) {
    return { status: 'skipped_recent', reason: 'account inactive' };
  }

  // dedup: 24h 내 SHARING Post 있으면 skip
  const since = new Date(Date.now() - DEDUP_WINDOW_HOURS * 60 * 60 * 1000);
  const recent = await prisma.post.findFirst({
    where: {
      accountId: acc.id,
      kind: PostKind.SHARING,
      createdAt: { gte: since },
      state: { notIn: [PostState.REJECTED, PostState.FAILED] },
    },
    select: { id: true, state: true, createdAt: true },
  });
  if (recent) {
    return {
      status: 'skipped_recent',
      reason: `최근 ${DEDUP_WINDOW_HOURS}h 내 SHARING post 있음 (postId=${recent.id}, state=${recent.state})`,
    };
  }

  // 카피 생성
  const copy = await generateSharingCopy({
    accountId: acc.id,
    variantCount: input.variantCount ?? 1,
  });
  const body = copy.variants[0]?.body;
  if (!body) {
    return { status: 'failed', reason: 'sharing copywriter returned no body' };
  }

  // Post 생성 (직접 PENDING_APPROVAL 로 삽입 · 스하리는 라우팅·매칭 단계 없음)
  const post = await prisma.post.create({
    data: {
      accountId: acc.id,
      kind: PostKind.SHARING,
      state: PostState.PENDING_APPROVAL,
      generatedBody: body,
      generatedReply: null, // 스하리 = 고정 댓글 없음
      mediaUrls: [],
      sourceMediaUrls: [],
    },
  });

  // 승인 카드 전송
  try {
    await sendApprovalRequest(post.id);
  } catch (err) {
    logger.error({ err, postId: post.id }, 'sharing approval request failed');
    await prisma.post.update({
      where: { id: post.id },
      data: { state: PostState.FAILED, rejectionReason: `approval-gate: ${(err as Error).message}` },
    });
    return { status: 'failed', postId: post.id, reason: (err as Error).message };
  }

  logger.info(
    { postId: post.id, accountId: acc.id, handle: acc.handle, bodyLen: body.length },
    'sharing post sent for approval',
  );
  return { status: 'sent_for_approval', postId: post.id, body };
}

/**
 * 활성 계정 전체에 대해 스하리 파이프라인 실행 (하루 1회 크론).
 */
export interface SharingBatchSummary {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  perAccount: Array<{ handle: string; status: string; reason?: string }>;
}

export async function runSharingForAllAccounts(): Promise<SharingBatchSummary> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, handle: true },
    orderBy: { handle: 'asc' },
  });

  const summary: SharingBatchSummary = {
    total: accounts.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    perAccount: [],
  };

  for (const acc of accounts) {
    try {
      const result = await runSharingPipeline({ accountId: acc.id });
      summary.perAccount.push({ handle: acc.handle, status: result.status, reason: result.reason });
      if (result.status === 'sent_for_approval') summary.sent += 1;
      else if (result.status === 'skipped_recent') summary.skipped += 1;
      else summary.failed += 1;
    } catch (err) {
      logger.error({ err, accountId: acc.id }, 'sharing pipeline crashed');
      summary.perAccount.push({ handle: acc.handle, status: 'failed', reason: (err as Error).message });
      summary.failed += 1;
    }
  }

  logger.info({ summary }, 'sharing batch done');
  return summary;
}
