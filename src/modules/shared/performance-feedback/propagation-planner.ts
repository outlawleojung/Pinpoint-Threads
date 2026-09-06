import { PostKind, PostState } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';

/**
 * Propagation Planner — 성과 피드백 루프 유닛 ③ (성과 게이팅 확산).
 *
 * 한 게시글이 24h·72h **둘 다** winner → 그 상품/벤치마크를 타 적격 계정에 확산.
 * 카피는 계정별 재생성(5계정 동일 콘텐츠 금지). 제약: 14일 동일상품 중복·성별·1일캡·동시발행(시차).
 *
 * 확산 대상 = SHOPPING 만. 스하리는 계정별 고유 소통 글이라 복제 확산 X.
 * 이 모듈은 **계획만** 산출(순수·side-effect 없음). 실제 카드 생성은 별도 실행 단계.
 */

const SHOPPING_DAILY_CAP = 2;
const DUP_LOOKBACK_DAYS = 14;

/**
 * 확산 절대 기준: **본문 조회 ≥ 이 값** 이면 확산 후보 (2026-09-06 사용자 방침).
 * 상대(내 글 중 best) 아님 — 절대 수치로 "진짜 터진 것"만 타 계정에 확산.
 * 24h·72h 둘 다 이 기준을 넘어야 함(지속 검증). 현재 최고 본문조회 3359 → 아직 아무것도 확산 안 됨(의도).
 * 본문조회 →(~10%) 댓글조회 →(∝) 클릭 퍼널 · 대시보드 확보 시 정밀 보정.
 */
export const PROPAGATION_MIN_POST_VIEWS = 10000;

export interface PropagationTarget {
  accountId: string;
  handle: string;
  eligible: boolean;
  reason: string;
}

export interface PropagationPlan {
  winnerPostId: string;
  originHandle: string;
  productId: string;
  productName: string;
  productGender: 'male' | 'female' | null;
  targets: PropagationTarget[];
}

function inferGender(productName: string): 'male' | 'female' | null {
  if (/여성|여자|우먼|레이디|women|female/i.test(productName)) return 'female';
  if (/남성|남자|맨즈|men|male/i.test(productName)) return 'male';
  return null;
}

/** 상품 성별 vs 계정 성별 충돌 판정 (pickLeastUsedAccount 정책과 동일 체계). */
function genderOk(productGender: 'male' | 'female' | null, accGender: string): boolean {
  if (productGender === 'male') return accGender === 'male' || accGender === 'unisex';
  if (productGender === 'female') return accGender === 'female' || accGender === 'unisex';
  // 애매(상품명에 성별 없음) → 남성 계정 제외 (오발행 방지)
  return accGender !== 'male';
}

async function evalTargets(
  originAccountId: string,
  productId: string,
  productGender: 'male' | 'female' | null,
): Promise<PropagationTarget[]> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, handle: true, audienceGender: true },
    orderBy: { handle: 'asc' },
  });
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dupSince = new Date(Date.now() - DUP_LOOKBACK_DAYS * 864e5);

  const out: PropagationTarget[] = [];
  for (const a of accounts) {
    if (a.id === originAccountId) {
      out.push({ accountId: a.id, handle: a.handle, eligible: false, reason: '원본 계정(발행처)' });
      continue;
    }
    if (!genderOk(productGender, a.audienceGender)) {
      out.push({ accountId: a.id, handle: a.handle, eligible: false, reason: `성별 불일치(상품:${productGender ?? '중성'}/계정:${a.audienceGender})` });
      continue;
    }
    const dup = await prisma.post.count({
      where: { accountId: a.id, commerceProductId: productId, createdAt: { gte: dupSince }, state: { notIn: [PostState.REJECTED, PostState.FAILED] } },
    });
    if (dup > 0) {
      out.push({ accountId: a.id, handle: a.handle, eligible: false, reason: `14일 내 동일상품 발행됨` });
      continue;
    }
    const todayCount = await prisma.post.count({
      where: { accountId: a.id, kind: PostKind.SHOPPING, createdAt: { gte: todayStart }, state: { notIn: [PostState.REJECTED, PostState.FAILED] } },
    });
    if (todayCount >= SHOPPING_DAILY_CAP) {
      out.push({ accountId: a.id, handle: a.handle, eligible: false, reason: `오늘 쇼핑 캡(${todayCount}/${SHOPPING_DAILY_CAP})` });
      continue;
    }
    out.push({ accountId: a.id, handle: a.handle, eligible: true, reason: 'OK' });
  }
  return out;
}

/**
 * 확산 계획 산출. 24h·72h 둘 다 SHOPPING winner 인 게시글 → 적격 타 계정 목록.
 * side-effect 없음(계획만).
 */
export async function planPropagation(): Promise<PropagationPlan[]> {
  // 절대 기준: 댓글 조회(클릭 게이트)가 24h·72h 둘 다 PROPAGATION_MIN_COMMENT_VIEWS 이상인 SHOPPING 만.
  const posts = await prisma.post.findMany({
    where: { state: PostState.PUBLISHED, kind: PostKind.SHOPPING, commerceProductId: { not: null } },
    select: {
      id: true,
      accountId: true,
      commerceProductId: true,
      account: { select: { handle: true } },
      commerceProduct: { select: { productName: true } },
      insightSnapshots: { select: { hoursAfterPublish: true, views: true } },
    },
  });
  const confirmed = posts.filter((p) => {
    const v = (h: number) => p.insightSnapshots.find((s) => s.hoursAfterPublish === h)?.views;
    const v24 = v(24);
    const v72 = v(72);
    // 본문 조회가 24h·72h 둘 다 절대 기준 이상 (지속 검증).
    return v24 != null && v72 != null && v24 >= PROPAGATION_MIN_POST_VIEWS && v72 >= PROPAGATION_MIN_POST_VIEWS;
  });

  const plans: PropagationPlan[] = [];
  for (const p of confirmed) {
    if (!p.commerceProductId) continue;
    const productName = p.commerceProduct?.productName ?? '';
    const productGender = inferGender(productName);
    const targets = await evalTargets(p.accountId, p.commerceProductId, productGender);
    plans.push({
      winnerPostId: p.id,
      originHandle: p.account?.handle ?? '?',
      productId: p.commerceProductId,
      productName,
      productGender,
      targets,
    });
  }
  logger.info({ confirmed: confirmed.length, plans: plans.length, threshold: PROPAGATION_MIN_POST_VIEWS }, 'propagation plan (절대 본문조회 기준)');
  return plans;
}

/**
 * 특정 게시글에 대한 확산 계획 미리보기 (confirm 게이트 무시 · 프리뷰/테스트용).
 * 적격 계정 산출 로직 검증에 사용.
 */
export async function previewPropagationFor(postId: string): Promise<PropagationPlan | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { accountId: true, commerceProductId: true, account: { select: { handle: true } }, commerceProduct: { select: { productName: true } } },
  });
  if (!post?.commerceProductId) return null;
  const productName = post.commerceProduct?.productName ?? '';
  const productGender = inferGender(productName);
  const targets = await evalTargets(post.accountId, post.commerceProductId, productGender);
  return { winnerPostId: postId, originHandle: post.account?.handle ?? '?', productId: post.commerceProductId, productName, productGender, targets };
}
