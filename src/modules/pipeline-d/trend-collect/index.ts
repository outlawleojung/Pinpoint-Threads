import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { CoupangAdapter, type CoupangBestProduct } from '../../../infra/commerce/coupang-client.js';

/**
 * Pipeline D 블로그 트렌드 수집기.
 *
 * Coupang 데이터를 NaverTrendKeyword 로 저장한다.
 * 일일 정보글(naver-daily-info)이 여기서 트렌딩 키워드를 골라 쓴다.
 *
 * ⚠️ Threads 트렌드 파이프라인(coupang-ranking.ts / TrendSignal)과 완전히 분리된 별도 저장소.
 *    이 모듈은 TrendSignal 을 읽거나 쓰지 않는다.
 *
 * 카테고리 소스 (2026-09-07 실측 검증, scripts/naver/verify-trend-collect.ts):
 * - bestcategories(코드) 로 1001~1031 전수 스캔한 결과, "주방용품"(1013)·"가전디지털"(1016) 은
 *   실제 상품군이 라벨과 합리적으로 일치했다.
 * - 그러나 "수납정리"용으로 시도한 1014 는 육아용품(기저귀봉투 등)이 압도적이었고, "인테리어소품"용
 *   으로 시도한 1015/1007 은 각각 일반 생활잡화·신발깔창이 압도적이라 라벨과 명백히 불일치했다.
 *   활성 코드 전수 스캔(1001~1031, 비활성/미존재 제외)에도 "홈인테리어"에 해당하는 코드가 없었다
 *   (1009 가 유력했으나 rCode=400 "category id is not active").
 * - 대신 기존 CoupangAdapter.search(keyword) 로 "수납정리"/"인테리어소품" 검색 시 카테고리명
 *   "홈인테리어"/"가구/홈인테리어" 상품이 정확히 반환됨을 확인 → 이 두 카테고리는 검색 기반으로 전환.
 */

type CategorySource =
  | { label: string; mode: 'BEST_CATEGORY'; code: number }
  | { label: string; mode: 'SEARCH'; keyword: string };

const BLOG_CATEGORIES: CategorySource[] = [
  { label: '레트로주방', mode: 'BEST_CATEGORY', code: 1013 },
  { label: '수납정리', mode: 'SEARCH', keyword: '수납정리' },
  { label: '인테리어소품', mode: 'SEARCH', keyword: '인테리어소품' },
  { label: '생활가전', mode: 'BEST_CATEGORY', code: 1016 },
];

const LIMIT_BEST_CATEGORY = 20;
const LIMIT_SEARCH = 10; // Coupang Search API 상한
const RETENTION_DAYS = 14;

interface TrendRow {
  category: string;
  keyword: string;
  source: string;
  rank: number;
  value: number;
  productHint: string | undefined;
  rawPayload: object;
}

export async function collectNaverTrends(): Promise<{ inserted: number; byCategory: Record<string, number> }> {
  const byCategory: Record<string, number> = {};

  if (!env.COUPANG_ACCESS_KEY || !env.COUPANG_SECRET_KEY) {
    logger.warn('COUPANG_ACCESS_KEY/SECRET 미설정 → naver-trend-collect skip');
    return { inserted: 0, byCategory };
  }

  const client = new CoupangAdapter(env.COUPANG_ACCESS_KEY, env.COUPANG_SECRET_KEY);
  let inserted = 0;

  for (const cat of BLOG_CATEGORIES) {
    byCategory[cat.label] = 0;
    try {
      const rows = await fetchCategoryRows(client, cat);

      // 오래된(14일+) 이 카테고리 행 정리 — 최근 미사용 행은 건드리지 않음.
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
      await prisma.naverTrendKeyword.deleteMany({
        where: { category: cat.label, collectedAt: { lt: cutoff } },
      });

      if (rows.length === 0) {
        logger.debug({ category: cat.label, mode: cat.mode }, 'naver-trend-collect: 상품 0개');
        continue;
      }

      const result = await prisma.naverTrendKeyword.createMany({ data: rows });
      inserted += result.count;
      byCategory[cat.label] = result.count;

      logger.debug(
        { category: cat.label, mode: cat.mode, count: result.count },
        'naver-trend-collect: 카테고리 수집 완료',
      );
    } catch (err) {
      logger.warn({ err, category: cat.label, mode: cat.mode }, 'naver-trend-collect: 카테고리 수집 실패, skip');
    }
  }

  logger.info({ inserted, byCategory }, 'naver-trend-collect done');
  return { inserted, byCategory };
}

async function fetchCategoryRows(client: CoupangAdapter, cat: CategorySource): Promise<TrendRow[]> {
  if (cat.mode === 'BEST_CATEGORY') {
    const products: CoupangBestProduct[] = await client.getBestByCategory(cat.code, {
      limit: LIMIT_BEST_CATEGORY,
    });
    return products.map((p) => ({
      category: cat.label,
      keyword: p.productName,
      source: 'COUPANG_RANKING',
      rank: p.rank,
      value: LIMIT_BEST_CATEGORY + 1 - p.rank,
      productHint: p.categoryName,
      rawPayload: p as unknown as object,
    }));
  }

  // SEARCH 모드: bestcategories 에 해당 라벨과 맞는 코드가 없어 키워드 검색으로 대체 (위 주석 참고).
  const results = await client.search(cat.keyword, { limit: LIMIT_SEARCH });
  return results.map((r, i) => {
    const rank = i + 1;
    return {
      category: cat.label,
      keyword: r.productName,
      source: 'COUPANG_SEARCH',
      rank,
      value: LIMIT_SEARCH + 1 - rank,
      productHint: r.category,
      rawPayload: r as unknown as object,
    };
  });
}
