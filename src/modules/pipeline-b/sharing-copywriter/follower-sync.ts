import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { ThreadsClient } from '../../../infra/threads-client.js';

/**
 * 계정 컨텍스트 (팔로워 수 + 계정 나이) 를 Threads API 로 갱신.
 * 매일 07:30 KST 크론 (스하리 발행 09:00 전) 이 유일한 정상 경로.
 * 캐시 TTL 24h. sharing-copywriter 는 캐시 재사용만.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface AccountContext {
  accountId: string;
  handle: string;
  followersCount: number;
  followerBucket: FollowerBucket;
  followerHints: string[];

  /** 실 계정 나이 (일 단위). null 이면 게시글 없음 or 미조회. */
  accountAgeDays: number | null;
  accountAgeBucket: AgeBucket;
  ageHints: string[];

  syncedAt: Date;
}

export type FollowerBucket = 'under_100' | '100_299' | '300_499' | '500_999' | '1000_plus';
export type AgeBucket = 'fresh_under_7d' | 'young_under_30d' | 'settled_1to3m' | 'mature_3m_plus' | 'unknown';

// ---------- Follower ----------

export function classifyFollowerBucket(count: number): FollowerBucket {
  if (count < 100) return 'under_100';
  if (count < 300) return '100_299';
  if (count < 500) return '300_499';
  if (count < 1000) return '500_999';
  return '1000_plus';
}

export function followerHintsFor(count: number): string[] {
  const bucket = classifyFollowerBucket(count);
  switch (bucket) {
    case 'under_100':
      return ['"아직 100도 안 됨"', '"이제 100 채우고 싶다"', '"0에서 시작"'];
    case '100_299':
      return ['"이제 100 넘음"', '"200 가는 중"', '"300 가고 싶다"'];
    case '300_499':
      return ['"이제 300 넘음"', '"500까지 가고 싶다"'];
    case '500_999':
      return ['"500 넘음"', '"1000 가보자"'];
    case '1000_plus':
      return ['"1000 넘음, 감사"', '"다음 목표 2000"'];
  }
}

// ---------- Age ----------

export function classifyAgeBucket(ageDays: number | null): AgeBucket {
  if (ageDays == null) return 'unknown';
  if (ageDays < 7) return 'fresh_under_7d';
  if (ageDays < 30) return 'young_under_30d';
  if (ageDays < 90) return 'settled_1to3m';
  return 'mature_3m_plus';
}

export function ageHintsFor(ageDays: number | null): string[] {
  const bucket = classifyAgeBucket(ageDays);
  switch (bucket) {
    case 'fresh_under_7d':
      return [
        '**허용**: "이제 막 시작", "N일차", "스린이", "완전 초짜", "0에서 시작"',
        '**금지**: "몇 달째", "오래", "꾸준히 해왔는데" (거짓 · 실제 며칠밖에 안 됨)',
      ];
    case 'young_under_30d':
      return [
        '**허용**: "시작한 지 얼마 안 됐어", "이제 좀 익숙해짐", "초짜 티 남", "몇 주 됐음"',
        '**금지**: "이제 막 시작", "1일차", "스린이" (거짓 · 이미 몇 주 됨) / "몇 달째", "오래" (거짓)',
      ];
    case 'settled_1to3m':
      return [
        '**허용**: "한두 달 됐어", "이제 좀 자리 잡았어", "슬슬 익숙"',
        '**금지**: "스린이", "이제 시작", "N일차" (거짓) / "1년째", "오래" (거짓)',
      ];
    case 'mature_3m_plus':
      return [
        '**허용**: "꾸준히 하는 중", "몇 달째 이러고 있어", "오래 됐는데도"',
        '**금지**: "이제 시작", "스린이", "초짜" (거짓)',
      ];
    case 'unknown':
      return [
        '계정 나이 미확인. 나이 특정 표현 지양. 일반 소통 요청 위주로.',
      ];
  }
}

// ---------- Sync ----------

/**
 * 매일 크론이 호출. 팔로워 수 + 계정 나이 (최초 1회 · 이후 재조회 skip · nullable 방지) 동기화.
 */
export async function syncAccountMetrics(accountId: string): Promise<AccountContext> {
  const acc = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      id: true,
      handle: true,
      accessToken: true,
      followersCount: true,
      followersSyncedAt: true,
      threadsCreatedAt: true,
    },
  });

  const client = new ThreadsClient();

  // Follower count (매번 갱신)
  let followersCount = acc.followersCount ?? 0;
  try {
    followersCount = await client.fetchFollowersCount(acc.accessToken);
  } catch (err) {
    logger.warn({ err, handle: acc.handle }, 'followers_count sync failed → 캐시 값 사용');
  }

  // Threads created (최초 1회만 계산 · 이후 캐시 재사용)
  let threadsCreatedAt = acc.threadsCreatedAt;
  if (!threadsCreatedAt) {
    try {
      threadsCreatedAt = await client.fetchOldestThreadTimestamp(acc.accessToken);
    } catch (err) {
      logger.warn({ err, handle: acc.handle }, 'threadsCreatedAt sync failed');
    }
  }

  const syncedAt = new Date();
  await prisma.account.update({
    where: { id: acc.id },
    data: {
      followersCount,
      followersSyncedAt: syncedAt,
      threadsCreatedAt: threadsCreatedAt ?? undefined,
    },
  });

  const ageDays = threadsCreatedAt
    ? Math.floor((Date.now() - threadsCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  logger.info(
    { handle: acc.handle, followersCount, threadsCreatedAt: threadsCreatedAt?.toISOString(), ageDays },
    'account metrics synced',
  );

  return buildContext({
    accountId: acc.id,
    handle: acc.handle,
    followersCount,
    accountAgeDays: ageDays,
    syncedAt,
  });
}

/**
 * copywriter 가 부르는 read-only. 캐시된 값 사용 · 없으면 syncAccountMetrics 트리거.
 */
export async function getAccountContext(accountId: string): Promise<AccountContext> {
  const acc = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      id: true, handle: true, accessToken: true,
      followersCount: true, followersSyncedAt: true, threadsCreatedAt: true,
    },
  });

  const stale =
    !acc.followersSyncedAt ||
    Date.now() - acc.followersSyncedAt.getTime() > CACHE_TTL_MS ||
    acc.followersCount == null;

  if (stale) {
    return syncAccountMetrics(accountId);
  }

  const ageDays = acc.threadsCreatedAt
    ? Math.floor((Date.now() - acc.threadsCreatedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return buildContext({
    accountId: acc.id,
    handle: acc.handle,
    followersCount: acc.followersCount ?? 0,
    accountAgeDays: ageDays,
    syncedAt: acc.followersSyncedAt ?? new Date(),
  });
}

function buildContext(input: {
  accountId: string;
  handle: string;
  followersCount: number;
  accountAgeDays: number | null;
  syncedAt: Date;
}): AccountContext {
  return {
    ...input,
    followerBucket: classifyFollowerBucket(input.followersCount),
    followerHints: followerHintsFor(input.followersCount),
    accountAgeBucket: classifyAgeBucket(input.accountAgeDays),
    ageHints: ageHintsFor(input.accountAgeDays),
  };
}

/** 활성 계정 전체 metrics 매일 갱신. */
export async function syncAllAccountMetrics(): Promise<Array<{ handle: string; ok: boolean; error?: string }>> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, handle: true },
    orderBy: { handle: 'asc' },
  });
  const results: Array<{ handle: string; ok: boolean; error?: string }> = [];
  for (const acc of accounts) {
    try {
      await syncAccountMetrics(acc.id);
      results.push({ handle: acc.handle, ok: true });
    } catch (err) {
      results.push({ handle: acc.handle, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
