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

const OPENER_POOL: string[] = [
  // — 음식 (벤치마크 검증: "벌써 배고프네" 323뷰)
  '벌써 배고프네',
  '아 라면 먹고 싶다',
  '간식 타이밍인데',
  '빵 먹고 싶다 진짜',
  '치킨 생각나네',
  '떡볶이 땡긴다',
  '밥 먹었는데 또 배고프다',
  '카페 가고 싶다',
  '아이스크림 먹고 싶네',
  '국물 땡기는 날이다',
  '커피 한 잔 하자',
  '뭐 먹지',
  // — 기분 (벤치마크 검증: "한숨 한 번 쉬고 간다" 440뷰)
  '한숨 한 번 쉬고 간다',
  '오늘 기분 좋다',
  '다들 오늘도 힘내자',
  '여유로운 하루 보내자',
  '별일 없는 게 좋은 거다',
  '왠지 좋은 일 생길 것 같다',
  '나른하다',
  '심심한데',
  '괜히 기분이 좋아졌다',
  '오늘 되게 평화롭네',
  '좋은 하루 보내는 중',
  // — 독백 (벤치마크 검증: "오늘은 진짜 집중 모드 켤게" 310뷰)
  '멍때리는 중',
  '뭐 하지',
  '아 잠깐만 쉬자',
  '갑자기 웃기다',
  '아 맞다 뭔가 깜빡했다',
  '혼자 중얼거리는 중',
  '아무 생각이 없다',
  '갑자기 생각나는 게 있다',
  '할 거 많은데 안 하는 중',
  '아 집중이 안 된다',
  // — 소소한 일상
  '산책이나 하고 싶다',
  '노래 틀어놓고 멍때리는 중',
  '하루가 빠르다',
  '옷 뭐 입지',
  '청소 좀 해야 되는데',
  '폰 배터리 없다',
  '샤워하고 싶다',
  '뭐 하다가 여기 왔지',
  '오늘 뭐 했지 벌써',
  // — 의지
  '오늘은 진짜 집중 모드 켤게',
  '오늘 할 일 좀 많다',
  '피곤한데 힘내본다',
  '미루지 말자 오늘만',
  '정리 좀 해야겠다',
  '오늘은 좀 부지런해져야지',
  // — 공감·질문
  '나만 이런가',
  '다들 뭐 하고 있어',
  '점심 뭐 먹지',
  '뭐 재밌는 거 없나',
  '이런 게 소확행이지',
  '다들 힘내고 있는 거지',
  '나만 멍하니 있는 건가',
];


/**
 * ★★ 2026-11-22: LLM 오프너 생성 완전 폐지.
 * 벤치마크 실측: TOP 성과 오프너 = OPENER_POOL과 동일한 짧은 혼잣말.
 * LLM이 "다른 소재로 써"하니 쌩뚱맞은 감성글이 나옴.
 * → 오프너 풀에서 직접 뽑고 스하리 꼬리만 붙인다.
 */
function pickOpener(
  variantIndex: number,
  hookOffset: number,
  recentBodies: string[],
): string {
  // 최근 사용된 오프너의 첫 줄 추출 (꼬리 제외)
  const usedOpeners = new Set(
    recentBodies.map((b) => b.split('\n')[0]?.trim() ?? b.trim()),
  );

  // offset + variant로 시작점 결정, 겹치면 다음으로
  const start = ((hookOffset + variantIndex) * 7) % OPENER_POOL.length;
  for (let i = 0; i < OPENER_POOL.length; i++) {
    const idx = (start + i) % OPENER_POOL.length;
    const candidate = OPENER_POOL[idx]!;
    if (!usedOpeners.has(candidate)) {
      return candidate;
    }
  }
  // 전부 사용됨 (거의 불가) → 랜덤
  return OPENER_POOL[Math.floor(Math.random() * OPENER_POOL.length)]!;
}

export class SharingBlacklistError extends Error {
  constructor(public term: string, public body: string, public soft = false) {
    super(`SHARING body contains forbidden ${soft ? 'pattern' : 'term'} "${term}": ${body.slice(0, 100)}`);
    this.name = 'SharingBlacklistError';
  }
}


/**
 * 오프너 풀에서 뽑아 스하리 꼬리 붙여 완성. LLM 호출 없음.
 */
function generateSharingBody(
  variantIndex: number,
  hookOffset: number,
  recentBodies: string[],
): string {
  const opener = pickOpener(variantIndex, hookOffset, recentBodies);
  const tail = pickSharingTail(variantIndex);
  return `${opener}\n${tail}`;
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


/**
 * 스하리 꼬리 문구 풀 — 계정·날짜별 회전. LLM이 생성한 일상 한마디 뒤에 붙는다.
 * 오글거리지 않으면서 스하리 요청이 담긴 짧은 한 줄.
 */
const SHARING_TAILS = [
  '스하리 남기면 반하리 감',
  '스하리 하자',
  '반하리 갈게',
  '스하리 ㄱ',
  '같이 키우자 스하리',
  '스하리 남기면 바로 감',
  '소통하자 스하리',
  '스하리 하면 갈게',
  '스하리 ㄱㄱ',
  '스하리 남겨줘',
  '반하리 바로 감',
  '소통 좋아 스하리',
  '스하리 놓고 가',
  '한 번 남겨봐 스하리',
  '가볍게 스하리',
  '스하리 한 번만',
];

function pickSharingTail(_seed?: number): string {
  return SHARING_TAILS[Math.floor(Math.random() * SHARING_TAILS.length)]!;
}

