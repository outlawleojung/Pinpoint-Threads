import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { ThreadsClient } from '../../../infra/threads-client.js';

/**
 * Account.followersCount 를 Threads API 로 갱신.
 * 6시간 캐시. 스하리 발행 직전 호출.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface FollowerContext {
  accountId: string;
  handle: string;
  followersCount: number;
  syncedAt: Date;
  bucket: FollowerBucket;
  phrasingHints: string[];
}

export type FollowerBucket = 'under_100' | '100_299' | '300_499' | '500_999' | '1000_plus';

export function classifyBucket(count: number): FollowerBucket {
  if (count < 100) return 'under_100';
  if (count < 300) return '100_299';
  if (count < 500) return '300_499';
  if (count < 1000) return '500_999';
  return '1000_plus';
}

/**
 * 구간별 허용 표현 힌트. 프롬프트에 넣어 "허구 수치·근거 없는 발언" 방지.
 * 실제 팔로워 수는 별도로 프롬프트에 명시. 이 힌트는 어투 참조용.
 */
export function phrasingHintsFor(count: number): string[] {
  const bucket = classifyBucket(count);
  switch (bucket) {
    case 'under_100':
      return [
        '"아직 100명도 안돼ㅠㅜ" · "이제 막 시작함" · "0에서 시작한 초짜"',
        '숫자 언급 시 실제 팔로워 수 근처만. 절대 부풀리지 말 것.',
      ];
    case '100_299':
      return [
        '"이제 겨우 100 넘음" · "100명 조금 넘었어" · "200 가는 중"',
        '"1000 채우기 프로젝트 시작" 같은 목표 표현은 OK.',
      ];
    case '300_499':
      return [
        '"이제 겨우 300 넘었어" · "300 왔음, 500 가자" · "400도 아직 멀었네"',
        '"조금씩 늘고 있음" 같은 겸손 톤 어울림.',
      ];
    case '500_999':
      return [
        '"500 넘었어! 1000까지 가보자" · "700 왔는데 여기가 고비같음"',
      ];
    case '1000_plus':
      return [
        '"1000 넘음 감사해ㅠㅜ" · "덕분에 1000 채웠어" · "다음 목표 2000"',
      ];
  }
}

export async function syncFollowerContext(accountId: string, force = false): Promise<FollowerContext> {
  const acc = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      id: true,
      handle: true,
      accessToken: true,
      followersCount: true,
      followersSyncedAt: true,
    },
  });

  const stale =
    force ||
    !acc.followersSyncedAt ||
    Date.now() - acc.followersSyncedAt.getTime() > CACHE_TTL_MS ||
    acc.followersCount == null;

  let followersCount = acc.followersCount ?? 0;
  let syncedAt = acc.followersSyncedAt ?? new Date(0);

  if (stale) {
    try {
      const client = new ThreadsClient();
      followersCount = await client.fetchFollowersCount(acc.accessToken);
      syncedAt = new Date();
      await prisma.account.update({
        where: { id: acc.id },
        data: { followersCount, followersSyncedAt: syncedAt },
      });
      logger.info({ accountId, handle: acc.handle, followersCount }, 'follower count synced');
    } catch (err) {
      logger.warn({ err, accountId }, 'follower count sync failed → 캐시 사용');
      if (acc.followersCount == null) {
        throw new Error(
          `팔로워 수 캐시 없음 + sync 실패: ${(err as Error).message}. 스하리 카피 생성 불가.`,
        );
      }
    }
  }

  return {
    accountId: acc.id,
    handle: acc.handle,
    followersCount,
    syncedAt,
    bucket: classifyBucket(followersCount),
    phrasingHints: phrasingHintsFor(followersCount),
  };
}
