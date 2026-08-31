import { env } from '../../../../config/env.js';
import { logger } from '../../../../config/logger.js';
import { TrendSource, TrendCategory } from '@prisma/client';
import { CoupangAdapter } from '../../../../infra/commerce/coupang-client.js';
import type { TrendSourceAdapter, RawTrendSignal } from '../index.js';

/**
 * 쿠팡 파트너스 · 카테고리별 베스트 랭킹 어댑터.
 *
 * 매 poll 시 카테고리별 상위 N개 상품을 수집 → productName을 keyword로 TrendSignal upsert.
 * upsertSignal이 previousValue → velocityPct 자동 계산 → 이전 대비 상승 감지.
 *
 * currentValue: (limit + 1 - rank) — 순위가 높을수록 큰 값
 *   예: rank 1 → 21 (limit=20), rank 20 → 1
 * velocity 급증 = 순위 급상승.
 *
 * 30-40대 여성 니치 카테고리에 집중.
 */

const WATCHED_CATEGORIES: Array<{
  code: number;
  label: string;
  ourCategory: TrendCategory;
}> = [
  { code: 1001, label: '여성패션', ourCategory: TrendCategory.FASHION },
  { code: 1010, label: '뷰티', ourCategory: TrendCategory.BEAUTY_SKINCARE },
  { code: 1011, label: '출산/유아동', ourCategory: TrendCategory.BABY_KIDS },
  { code: 1012, label: '식품', ourCategory: TrendCategory.FOOD },
  { code: 1013, label: '주방용품', ourCategory: TrendCategory.KITCHEN },
  { code: 1014, label: '생활용품', ourCategory: TrendCategory.HOME },
  { code: 1015, label: '홈인테리어', ourCategory: TrendCategory.HOME },
  { code: 1024, label: '헬스/건강식품', ourCategory: TrendCategory.HEALTH },
];

const LIMIT_PER_CATEGORY = 20;

export class CoupangRankingAdapter implements TrendSourceAdapter {
  readonly source = TrendSource.COUPANG_RANKING;

  async fetchSignals(): Promise<RawTrendSignal[]> {
    if (!env.COUPANG_ACCESS_KEY || !env.COUPANG_SECRET_KEY) {
      logger.warn('COUPANG_ACCESS_KEY/SECRET 미설정 → 쿠팡 랭킹 어댑터 skip');
      return [];
    }

    const client = new CoupangAdapter(env.COUPANG_ACCESS_KEY, env.COUPANG_SECRET_KEY);
    const signals: RawTrendSignal[] = [];

    for (const cat of WATCHED_CATEGORIES) {
      try {
        const products = await client.getBestByCategory(cat.code, { limit: LIMIT_PER_CATEGORY });
        for (const p of products) {
          const brand = extractBrand(p.productName);
          const value = LIMIT_PER_CATEGORY + 1 - p.rank; // rank 1 = highest signal
          signals.push({
            source: this.source,
            keyword: p.productName,
            category: cat.ourCategory,
            brand,
            productHint: p.productName,
            currentValue: value,
            rawPayload: {
              coupangCategoryCode: cat.code,
              coupangCategoryLabel: cat.label,
              productId: p.productId,
              price: p.productPrice,
              productUrl: p.productUrl,
              thumbnail: p.productImage,
              rank: p.rank,
              isRocket: p.isRocket,
            },
          });
        }
        logger.debug(
          { category: cat.label, code: cat.code, count: products.length },
          'coupang category polled',
        );
        // API rate limit 완화: 카테고리 간 짧은 딜레이
        await sleep(400);
      } catch (err) {
        logger.warn({ err, category: cat.label }, 'coupang category poll failed');
      }
    }

    logger.info(
      { fetched: signals.length, categories: WATCHED_CATEGORIES.length },
      'coupang ranking fetched',
    );
    return signals;
  }
}

/**
 * 상품명 앞머리에서 브랜드 추측 (첫 단어 or 대괄호 안 값).
 * 정확도 낮지만 시그널 참고용.
 */
function extractBrand(productName: string): string | undefined {
  const bracket = /^\[([^\]]+)\]/.exec(productName);
  if (bracket) return bracket[1]?.trim();
  const firstWord = productName.split(/\s+/)[0];
  if (firstWord && firstWord.length >= 2 && firstWord.length <= 12) return firstWord;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
