import { PostKind, PostState } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { scoreAllPublished } from './scorer.js';

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
  const [s24, s72] = await Promise.all([scoreAllPublished(24), scoreAllPublished(72)]);
  const win24 = new Set(s24.filter((s) => s.kind === PostKind.SHOPPING && s.rank === 'winner').map((s) => s.postId));
  const confirmed = s72.filter((s) => s.kind === PostKind.SHOPPING && s.rank === 'winner' && win24.has(s.postId));

  const plans: PropagationPlan[] = [];
  for (const w of confirmed) {
    const post = await prisma.post.findUnique({
      where: { id: w.postId },
      select: { accountId: true, commerceProductId: true, account: { select: { handle: true } }, commerceProduct: { select: { productName: true } } },
    });
    if (!post?.commerceProductId) continue;
    const productName = post.commerceProduct?.productName ?? '';
    const productGender = inferGender(productName);
    const targets = await evalTargets(post.accountId, post.commerceProductId, productGender);
    plans.push({
      winnerPostId: w.postId,
      originHandle: post.account?.handle ?? '?',
      productId: post.commerceProductId,
      productName,
      productGender,
      targets,
    });
  }
  logger.info({ confirmedWinners: confirmed.length, plans: plans.length }, 'propagation plan computed');
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
