import { CommerceRouter } from '../../../infra/commerce/router.js';
import { CoupangAdapter } from '../../../infra/commerce/coupang-client.js';
import { MusinsaAdapter } from '../../../infra/commerce/musinsa-client.js';
import type { CommerceSearchResult } from '../../../infra/commerce/types.js';
import { verifyProductMatch, type VisionMatchResult } from '../vision-verifier/index.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

/**
 * Product Matcher — Pipeline A 전용.
 * 검색 키워드 + 카테고리 → 채널 라우팅 → 상품 검색 → Vision Self-Correction Loop.
 *
 * 매칭 실패 처리 (docs/01-pipelines/A-shopping.md § 7):
 * - 동일 우선, 유사 허용 (Vision score >= 0.65)
 * - 3회 재시도 후 실패면 폐기
 *
 * TODO(Phase 3a): CoupangAdapter·MusinsaAdapter 실 구현 필요 (현재 stub)
 */

export interface MatchInput {
  category: string;
  searchKeyword: string;
  sourceImageUrl: string;
  maxAttempts?: number;
}

export interface MatchResult {
  channel: 'COUPANG' | 'MUSINSA';
  product: CommerceSearchResult;
  visionScore: number;
  attempts: number;
  deeplinkUrl: string;
}

export type MatchOutcome =
  | { success: true; result: MatchResult }
  | { success: false; reason: 'no-candidates' | 'vision-failed' | 'error'; attempts: number };

function createRouter(): CommerceRouter {
  return new CommerceRouter({
    coupang: new CoupangAdapter(env.COUPANG_ACCESS_KEY ?? '', env.COUPANG_SECRET_KEY ?? ''),
    musinsa: new MusinsaAdapter(env.MUSINSA_API_KEY ?? '', env.MUSINSA_PARTNER_ID ?? ''),
  });
}

export async function matchProduct(input: MatchInput): Promise<MatchOutcome> {
  const router = createRouter();
  const primary = router.pick(input.category);
  const maxAttempts = input.maxAttempts ?? 3;
  let keyword = input.searchKeyword;
  let attempts = 0;

  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    let candidates: CommerceSearchResult[];
    try {
      candidates = await primary.search(keyword, { limit: 5 });
    } catch (err) {
      logger.error({ err, attempts, channel: primary.channel }, 'product search failed');
      return { success: false, reason: 'error', attempts };
    }
    if (!candidates.length) {
      logger.info({ keyword, attempts }, 'no candidates');
      keyword = broadenKeyword(keyword);
      continue;
    }

    for (const candidate of candidates) {
      let vision: VisionMatchResult;
      try {
        vision = await verifyProductMatch({
          sourceImageUrl: input.sourceImageUrl,
          productThumbnailUrl: candidate.thumbnailUrl,
        });
      } catch (err) {
        logger.error({ err }, 'vision verify failed');
        continue;
      }
      if (vision.matched && vision.score >= 0.65) {
        const deeplinkUrl = await primary.generateDeeplink(candidate.productUrl);
        logger.info({ candidate: candidate.productName, score: vision.score }, 'match found');
        return {
          success: true,
          result: {
            channel: primary.channel,
            product: candidate,
            visionScore: vision.score,
            attempts,
            deeplinkUrl,
          },
        };
      }
    }
    // 이번 회차 candidate 모두 vision 실패 → 키워드 조정
    keyword = broadenKeyword(keyword);
  }

  return { success: false, reason: 'vision-failed', attempts: maxAttempts };
}

function broadenKeyword(keyword: string): string {
  // 간단한 키워드 확장: 마지막 수식어 제거 or 일반화
  const words = keyword.split(/\s+/);
  if (words.length > 1) return words.slice(0, -1).join(' ');
  return keyword;
}
