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
 * - 동일 우선, 유사 허용 (Vision score >= 0.85)
 * - 3회 재시도 후 실패면 폐기
 *
 * TODO(Phase 3a): CoupangAdapter·MusinsaAdapter 실 구현 필요 (현재 stub)
 */

export interface MatchInput {
  category: string;
  searchKeyword: string;
  sourceImageUrl: string;
  maxAttempts?: number;
  /**
   * true 면 검색어(상품명)를 사용자가 직접 지정한 것으로 신뢰.
   * Vision 0.85 미달이라도 **가장 유사한 후보를 선택** (검색 결과 있으면 폐기 안 함).
   * false(기본): Vision >= 0.85 만 채택 (자동 매칭 · 오매칭 방지).
   */
  trustKeyword?: boolean;
}

export interface MatchResult {
  channel: 'COUPANG' | 'MUSINSA' | 'NAVER';
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
      // 비용 절감: 후보 5→3 (Vision 호출이 후보당 1회 · 가장 비쌈)
      candidates = await primary.search(keyword, { limit: 3 });
    } catch (err) {
      logger.error({ err, attempts, channel: primary.channel }, 'product search failed');
      return { success: false, reason: 'error', attempts };
    }
    if (!candidates.length) {
      logger.info({ keyword, attempts }, 'no candidates');
      keyword = broadenKeyword(keyword);
      continue;
    }

    // 상품명을 사용자가 지정한 경우(trustKeyword): Vision 스킵 · 검색어와 **이름이 가장 비슷한 후보** 선택.
    // coupang 이 top 을 항상 정확히 주지 않으므로 (예: "팍스홈" 검색에 "어썸H" 를 top 으로) 문자열 유사도로 재정렬.
    if (input.trustKeyword) {
      const best = pickByNameSimilarity(input.searchKeyword, candidates);
      const deeplinkUrl = await primary.generateDeeplink(best.productUrl);
      logger.info({ candidate: best.productName, keyword: input.searchKeyword, trusted: true }, 'match by trusted keyword (name-similar)');
      return {
        success: true,
        result: { channel: primary.channel, product: best, visionScore: 1, attempts, deeplinkUrl },
      };
    }

    let bestCandidate: CommerceSearchResult | null = null;
    let bestScore = -1;
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
      if (vision.score > bestScore) {
        bestScore = vision.score;
        bestCandidate = candidate;
      }
      if (vision.matched && vision.score >= 0.85) {
        const deeplinkUrl = await primary.generateDeeplink(candidate.productUrl);
        logger.info({ candidate: candidate.productName, score: vision.score }, 'match found');
        return {
          success: true,
          result: { channel: primary.channel, product: candidate, visionScore: vision.score, attempts, deeplinkUrl },
        };
      }
    }
    // 상품명을 사용자가 지정한 경우(trustKeyword): Vision 0.85 미달이라도 최고 점수 후보 채택.
    // 사용자가 상품을 이미 확정했고, 최종 승인 카드에서 육안 확인하므로.
    if (input.trustKeyword && bestCandidate) {
      const deeplinkUrl = await primary.generateDeeplink(bestCandidate.productUrl);
      logger.info({ candidate: bestCandidate.productName, score: bestScore, trusted: true }, 'match by trusted keyword (best of candidates)');
      return {
        success: true,
        result: { channel: primary.channel, product: bestCandidate, visionScore: bestScore, attempts, deeplinkUrl },
      };
    }
    // 자동 매칭: 이번 회차 candidate 모두 vision 미달 → 키워드 조정
    keyword = broadenKeyword(keyword);
  }

  return { success: false, reason: 'vision-failed', attempts: maxAttempts };
}

/**
 * 검색어와 상품명의 토큰 겹침으로 가장 비슷한 후보 선택.
 * 사용자가 입력한 상품명의 단어들이 가장 많이 포함된 상품 = 정답에 가까움.
 */
function pickByNameSimilarity(keyword: string, candidates: CommerceSearchResult[]): CommerceSearchResult {
  const kwTokens = keyword.split(/\s+/).filter((t) => t.length >= 2);
  let best = candidates[0]!;
  let bestScore = -1;
  for (const c of candidates) {
    const name = c.productName ?? '';
    const hits = kwTokens.filter((t) => name.includes(t)).length;
    if (hits > bestScore) {
      bestScore = hits;
      best = c;
    }
  }
  return best;
}

function broadenKeyword(keyword: string): string {
  // 간단한 키워드 확장: 마지막 수식어 제거 or 일반화
  const words = keyword.split(/\s+/);
  if (words.length > 1) return words.slice(0, -1).join(' ');
  return keyword;
}
