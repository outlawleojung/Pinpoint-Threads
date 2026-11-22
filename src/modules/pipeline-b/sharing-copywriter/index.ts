import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { getAccountContext } from './follower-sync.js';
import { PostKind, PostState } from '@prisma/client';


/**
 * Pipeline B 스하리 카피라이터 (2026-11-22 개편).
 *
 * 벤치마크 실측 결과: TOP 성과 스하리는 LLM이 쓴 창작물이 아니라
 * "벌써 배고프네", "한숨 한 번 쉬고 간다" 같은 짧은 혼잣말.
 * → LLM 오프너 생성 완전 폐지, 검증된 오프너 풀에서 직접 선택.
 */

/**
 * 스하리 토픽 태그 — **본문 텍스트 금지**.
 * Threads `topic_tag` 파라미터로만 부착 → 게시물엔 태그로 붙지만 본문 글자엔 안 들어감 (사용자 방침).
 * (# 없이, ≤50자, 마침표·& 금지)
 */
export const SHARING_TOPIC_TAG = '스하리1000명프로젝트';



export interface SharingCopyInput {
  accountId: string;
  variantCount?: number;
  /** 계정 간 훅 다양화 offset. 여러 계정 순회 시 각 계정마다 다른 훅 배정. */
  hookOffset?: number;
}

export interface SharingCopyResult {
  accountId: string;
  handle: string;
  followersCount: number;
  followerBucket: string;
  variants: Array<{
    body: string;
    hookLabel: string;
    referencesUsed: Array<{ id: string; sourceHandle: string; repliesCount: number }>;
  }>;
}

// ★★ 2026-11-22: LLM 오프너 생성 완전 폐지.
// 벤치마크 실측 결과, TOP 성과 스하리 오프너("벌써 배고프네", "한숨 한 번 쉬고 간다")는
// HOOK_QUERIES와 거의 동일한 짧은 혼잣말이었음.
// LLM이 "힌트와 다른 소재"를 쓰게 하니 쌩뚱맞은 감성 에세이가 나옴 → 직접 사용으로 전환.
//
// 오프너 풀 (OPENER_POOL)에서 직접 뽑고 스하리 꼬리만 붙인다.
// LLM 비용 0, 할루시네이션 0, 검증된 패턴만 사용.

// ★★ 2026-11-22: 오프너+꼬리 분리 구조 폐지.
// 벤치마크 TOP 성과는 글 전체가 스하리 소통 자체.
// "산책이나 하고 싶다 / 스하리 ㄱ" ← 이런 뜬금없는 조합이 아니라
// "스하리 남기면 반하리 바로 감" 처럼 글 전체가 하나의 메시지.
const POST_POOL: string[] = [
  // — 반하리 약속형 (벤치마크 440뷰, 377뷰)
  '스하리 남기면 반하리 감',
  '스하리 남겨주면 반하리 바로 간다',
  '스하리 하자 반하리 갈게',
  '스하리 남기면 바로 감 약속',
  '오늘도 소통하자 스하리 남기면 반하리 감',
  '스하리 남겨줘 반하리 꼭 갈게',
  '같이 키우자 스하리 남기면 반하리 감',
  '스하리 하면 반하리 바로 감 진짜',
  // — 소통 제안형
  '소통하고 싶다 스하리 남겨줘',
  '스하리 한 번 남겨봐 바로 감',
  '오늘 소통 좀 하자 스하리 ㄱ',
  '스친 늘리고 싶다 스하리 남겨줘',
  '스하리 남기면 갈게 소통하자',
  '같이 소통해요 스하리 남기면 바로 감',
  // — 자기 경험형 (벤치마크 891뷰, 370뷰)
  '스하리 하다 보면 스친 늘겠지 남기면 감',
  '맨날 스하리 하는데 아직 갈 길이 멀다ㅋㅋ 남기면 반하리 감',
  '스하리 꾸준히 하는 중 남겨주면 바로 감',
  '오늘도 스하리 돌리는 중 남기면 반하리 감',
  '스하리 하면서 스친 늘리는 중 남겨줘',
  '반하리 안 오면 서운하잖아 나는 꼭 감',
  // — 함께하자형 (벤치마크 377뷰)
  '함께하자 스하리 남기면 반하리 바로 감',
  '같이 키우자 스하리 남겨줘',
  '다 같이 소통하자 스하리 남기면 감',
  '서로 키워주자 스하리 하면 반하리 감',
  '같이 가자 스하리 남기면 바로 감',
  // — 짧고 강렬형
  '스하리 ㄱ 반하리 바로 감',
  '스하리 하자',
  '소통 ㄱㄱ 스하리 남기면 감',
  '반하리 갈게 스하리 남겨줘',
  '스하리 놓고 가 반하리 감',
  // — 가벼운 톤
  '심심한데 스하리 하자 반하리 감',
  '스하리 한 번만 남겨줘 반하리 갈게',
  '오늘 뭐 하지 스하리나 하자 남기면 감',
  '스하리 남기면 반하리 감 가볍게 소통하자',
];


function pickPost(
  variantIndex: number,
  hookOffset: number,
  recentBodies: string[],
): string {
  const usedPosts = new Set(recentBodies.map((b) => b.trim()));

  const start = ((hookOffset + variantIndex) * 7) % POST_POOL.length;
  for (let i = 0; i < POST_POOL.length; i++) {
    const idx = (start + i) % POST_POOL.length;
    const candidate = POST_POOL[idx]!;
    if (!usedPosts.has(candidate)) {
      return candidate;
    }
  }
  return POST_POOL[Math.floor(Math.random() * POST_POOL.length)]!;
}

export class SharingBlacklistError extends Error {
  constructor(public term: string, public body: string, public soft = false) {
    super(`SHARING body contains forbidden ${soft ? 'pattern' : 'term'} "${term}": ${body.slice(0, 100)}`);
    this.name = 'SharingBlacklistError';
  }
}


function generateSharingBody(
  variantIndex: number,
  hookOffset: number,
  recentBodies: string[],
): string {
  return pickPost(variantIndex, hookOffset, recentBodies);
}

/**
 * 스하리 카피 생성 (2026-11-22 개편).
 * LLM 호출 없이 검증된 오프너 풀에서 직접 뽑고 스하리 꼬리만 붙인다.
 */
export async function generateSharingCopy(
  input: SharingCopyInput,
): Promise<SharingCopyResult> {
  const variantCount = input.variantCount ?? 1;

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { id: true, handle: true },
  });

  const context = await getAccountContext(input.accountId);

  // 최근 14일 스하리 본문 (전 계정) → 반복 회피용
  const recentBodies = await loadRecentSharingBodies(40);

  const variants: SharingCopyResult['variants'] = [];
  const offset = input.hookOffset ?? 0;
  for (let i = 0; i < variantCount; i++) {
    const body = generateSharingBody(i, offset, recentBodies);
    variants.push({
      body,
      hookLabel: 'pool',
      referencesUsed: [],
    });
  }

  logger.info(
    {
      accountId: account.id,
      handle: account.handle,
      followers: context.followersCount,
      followerBucket: context.followerBucket,
      variantsProduced: variants.length,
    },
    'sharing copy generated (pool-based, no LLM)',
  );

  return {
    accountId: account.id,
    handle: account.handle,
    followersCount: context.followersCount,
    followerBucket: context.followerBucket,
    variants,
  };
}


/** 최근 7일 스하리 본문 (전 계정 · 리젝/실패 제외) — 반복 회피용. */
async function loadRecentSharingBodies(limit: number): Promise<string[]> {
  try {
    const since = new Date(Date.now() - 14 * 864e5);
    const posts = await prisma.post.findMany({
      where: {
        kind: PostKind.SHARING,
        createdAt: { gte: since },
        generatedBody: { not: null },
        state: { notIn: [PostState.REJECTED, PostState.FAILED] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { generatedBody: true },
    });
    return posts.map((p) => p.generatedBody).filter((b): b is string => !!b);
  } catch {
    return [];
  }
}



