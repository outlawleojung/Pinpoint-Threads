import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { CoupangAdapter } from '../../../infra/commerce/coupang-client.js';
import { PostKind, PostState } from '@prisma/client';

/**
 * Line B (상품 우선) 상품 선정기.
 *
 * 사용자 URL 없이 쿠팡 베스트셀러에서 **돈 되는 상품 2~3개 미니 세트**를 자동 선정.
 * - 계정 성별에 맞는 카테고리 풀
 * - 가격밴드 필터 (너무 싸구려·초고가 제외 → 수수료·전환 균형)
 * - 최근 사용 상품 dedup (14일)
 * - 각 상품 canonical URL → 파트너스 딥링크 자동 생성 (실측: canonical 만 변환 성공)
 *
 * 미디어는 API 썸네일(productImage) 사용 — 상세페이지 스크래핑은 Access Denied 로 불가.
 */

const PRICE_MIN = 8_000;
const PRICE_MAX = 300_000;
const SET_SIZE = 3; // 목표 상품 수 (최소 2 충족 시 발행 가능 — 미디어 2+ 룰)
const DEDUP_DAYS = 14;

// 쿠팡 카테고리 코드 (성별·페르소나 정합)
const CATEGORY_KR: Record<number, string> = {
  1001: '여성패션',
  1002: '남성패션',
  1010: '뷰티',
  1013: '주방용품',
  1014: '생활용품',
  1015: '홈인테리어',
  1016: '가전디지털',
  1017: '스포츠/레저',
};

function categoryPoolFor(gender: string | null | undefined): number[] {
  if (gender === 'male') return [1016, 1002, 1017, 1013];
  if (gender === 'female') return [1010, 1001, 1015, 1013];
  return [1010, 1001, 1016, 1015, 1013, 1017]; // unisex
}

export interface LineBProduct {
  externalId: string;
  productName: string;
  price: number;
  thumbnailUrl: string;
  productUrl: string; // canonical
  deeplinkUrl: string;
  categoryKr: string;
}

export interface LineBSet {
  categoryKr: string;
  products: LineBProduct[]; // 2~3개
}

/**
 * 계정에 맞는 미니 세트 1개 선정. 후보 없으면 null.
 * @param excludeExternalIds 이번 배치에서 다른 계정이 이미 가져간 상품 (계정 간 dedup)
 */
export async function selectLineBSet(
  accountId: string,
  excludeExternalIds: string[] = [],
): Promise<LineBSet | null> {
  if (!env.COUPANG_ACCESS_KEY || !env.COUPANG_SECRET_KEY) {
    logger.warn('COUPANG 키 미설정 → Line B 선정 불가');
    return null;
  }
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { audienceGender: true },
  });

  const recentlyUsed = await getRecentlyUsedProductIds(accountId, DEDUP_DAYS);
  const exclude = new Set<string>([...recentlyUsed, ...excludeExternalIds]);

  const client = new CoupangAdapter(env.COUPANG_ACCESS_KEY, env.COUPANG_SECRET_KEY);
  const pool = categoryPoolFor(account.audienceGender);

  for (const categoryCode of pool) {
    let best;
    try {
      best = await client.getBestByCategory(categoryCode, { limit: 30, imageSize: '512x512' });
    } catch (err) {
      logger.warn({ err, categoryCode }, 'Line B: bestcategories 조회 실패 · 다음 카테고리');
      continue;
    }

    // 가격밴드 + dedup + 썸네일 존재
    const eligible = best.filter(
      (p) =>
        p.productPrice >= PRICE_MIN &&
        p.productPrice <= PRICE_MAX &&
        !!p.productImage &&
        !exclude.has(String(p.productId)),
    );
    if (eligible.length < 2) continue;

    // 상위 랭킹에서 SET_SIZE 개 선택 (이미 rank 순). 딥링크 생성 성공한 것만.
    const products: LineBProduct[] = [];
    for (const p of eligible) {
      if (products.length >= SET_SIZE) break;
      const canonical = `https://www.coupang.com/vp/products/${p.productId}`;
      let deeplinkUrl: string;
      try {
        deeplinkUrl = await client.generateDeeplink(canonical);
      } catch (err) {
        logger.warn({ err, productId: p.productId }, 'Line B: 딥링크 생성 실패 · 상품 skip');
        continue;
      }
      products.push({
        externalId: String(p.productId),
        productName: p.productName,
        price: p.productPrice,
        thumbnailUrl: p.productImage,
        productUrl: canonical,
        deeplinkUrl,
        categoryKr: CATEGORY_KR[categoryCode] ?? '쇼핑',
      });
    }

    if (products.length >= 2) {
      logger.info(
        { accountId, categoryCode, count: products.length, names: products.map((p) => p.productName.slice(0, 24)) },
        'Line B set selected',
      );
      return { categoryKr: CATEGORY_KR[categoryCode] ?? '쇼핑', products };
    }
  }

  logger.warn({ accountId }, 'Line B: 적합한 미니 세트 없음 (모든 카테고리 소진)');
  return null;
}

/**
 * 최근 N일 이 계정에 사용된 CommerceProduct.externalId (Line B·A 공통 dedup).
 */
async function getRecentlyUsedProductIds(accountId: string, days: number): Promise<string[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const posts = await prisma.post.findMany({
    where: {
      accountId,
      kind: PostKind.SHOPPING,
      createdAt: { gte: since },
      state: { notIn: [PostState.REJECTED, PostState.FAILED] },
      commerceProduct: { isNot: null },
    },
    select: { commerceProduct: { select: { externalId: true } } },
  });
  return posts.map((p) => p.commerceProduct?.externalId).filter((x): x is string => !!x);
}
