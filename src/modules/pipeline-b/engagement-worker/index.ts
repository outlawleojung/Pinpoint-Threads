import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';

/**
 * Engagement Worker (Pipeline B — 스하리).
 * Comment Watcher → Follow Verifier → Reciprocation Executor 3-단.
 * 계정 정지 리스크 가장 큰 모듈. 하드 캡 3~5회/일, 랜덤 지터 10~30분.
 *
 * TODO(Phase 5): 실 구현. Meta 승인 + Threads API 팔로우 엔드포인트 확인 후.
 * 상세 사양: docs/09-agents/pipeline-b/engagement-worker.md
 */

export interface ReciprocationJob {
  accountId: string;
  suhariPostId: string;
  commenterHandle: string;
  commenterThreadsUserId: string;
  commentText: string;
  detectedAt: string;
}

export async function pollComments(_accountId: string): Promise<void> {
  logger.warn({ accountId: _accountId }, 'engagement-worker.pollComments not implemented (Phase 5)');
}

export async function verifyFollow(_targetUserId: string, _accountId: string): Promise<boolean> {
  logger.warn('engagement-worker.verifyFollow not implemented (Phase 5)');
  return false;
}

export async function reciprocate(job: ReciprocationJob): Promise<void> {
  // 하드 캡 체크
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dailyCount = await prisma.dailyPostCount.findUnique({
    where: { accountId_date: { accountId: job.accountId, date: today } },
  });
  const limit = randomDailyLimit();
  if ((dailyCount?.engagementCount ?? 0) >= limit) {
    logger.info(
      { accountId: job.accountId, limit, current: dailyCount?.engagementCount },
      'reciprocation daily cap reached, skip',
    );
    return;
  }

  // TODO(Phase 5): Threads API follow, +1 counter, random jitter
  logger.warn({ job }, 'engagement-worker.reciprocate not implemented (Phase 5)');
}

function randomDailyLimit(): number {
  const min = env.ENGAGEMENT_DAILY_LIMIT; // 3
  const max = env.ENGAGEMENT_DAILY_LIMIT + 2; // 5
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
