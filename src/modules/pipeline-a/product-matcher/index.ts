import { CommerceRouter } from '../../../infra/commerce/router.js';
import { CoupangAdapter } from '../../../infra/commerce/coupang-client.js';
import { MusinsaAdapter } from '../../../infra/commerce/musinsa-client.js';
import type { CommerceSearchResult } from '../../../infra/commerce/types.js';
import { verifyProductMatch, type VisionMatchResult } from '../vision-verifier/index.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { llm } from '../../../infra/llm/index.js';

// 쿠팡 검색 API 키워드 상한 (rCode=400 "keyword maximum length is 50")
const COUPANG_KEYWORD_MAX = 50;

/**
 * 50자 초과 상품명을 쿠팡 검색용 짧은 한국어 키워드로 압축.
 * 브랜드·해외직구·정품·영어 나열 등 노이즈 제거, 핵심 상품종류 위주.
 * 실패 시 앞 50자로 안전 절단.
 */
async function compactKeyword(long: string): Promise<string> {
  try {
    const res = await llm().complete({
      tier: 'fast',
      system:
        '상품명을 쿠팡 검색용 짧은 한국어 검색어로 바꿔라. 핵심 상품 종류 위주 3~6단어, ' +
        '유명 브랜드만 유지, "정품·해외직구·세트·수량·영어 나열" 같은 노이즈 제거. 결과 검색어만 출력.',
      userParts: [{ type: 'text', text: long }],
      maxOutputTokens: 40,
      temperature: 0.2,
      thinking: 'disabled',
    });
    const out = (res.text.trim().split('\n')[0] ?? '').replace(/^["'`]|["'`]$/g, '').trim();
    const capped = out.slice(0, COUPANG_KEYWORD_MAX);
    return capped.length >= 2 ? capped : long.slice(0, COUPANG_KEYWORD_MAX);
  } catch (err) {
    logger.warn({ err }, 'compactKeyword 실패 · 앞 50자 절단');
    return long.slice(0, COUPANG_KEYWORD_MAX);
  }
}

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
  // 쿠팡 검색어 50자 초과 시 압축 (긴 상품명 그대로 보내면 400 · matcher error).
  //   검색엔 압축 키워드, 이름 유사도(pickByNameSimilarity)엔 원본 상품명 유지.
  let keyword =
    input.searchKeyword.length > COUPANG_KEYWORD_MAX
      ? await compactKeyword(input.searchKeyword)
      : input.searchKeyword;
  if (keyword !== input.searchKeyword) {
    logger.info({ original: input.searchKeyword.slice(0, 80), compacted: keyword }, 'search keyword compacted (>50자)');
  }
  // trustKeyword: 코드·단위 노이즈(OAP97A4S·2.5·g) 제거 후 검색 — 쿠팡 관련도↑. broaden 도 정제된 토큰 기준으로.
  //   (유사도 판정엔 원본 input.searchKeyword 유지.)
  if (input.trustKeyword) keyword = stripSearchNoise(keyword);
  let attempts = 0;

  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    let candidates: CommerceSearchResult[];
    try {
      // trustKeyword(수동 상품명): 브랜드 상품이 top 밖에 밀리는 경우가 있어 넓게(10개) 본 뒤
      //   이름 유사도+브랜드/품목 게이트로 정확히 고른다. 자동 매칭: 6개.
      const searchLimit = input.trustKeyword ? 10 : 6;
      candidates = await primary.search(keyword, { limit: searchLimit });
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
      // 브랜드(사용자 상품명 첫 실단어)를 담은 후보가 있으면 그 안에서만 고른다.
      //   "무인양품 립스틱" 검색에 "아미옥 …오클린베이지"가 섞여 들어와도, "베이지"(색상) 같은
      //   흔한 단어로 다른 브랜드가 뽑히는 걸 막는다. 브랜드 후보 없으면 전체에서.
      const meaningful = stripSearchNoise(input.searchKeyword).split(/\s+/).filter((t) => t.length >= 2);
      const brand = meaningful[0];
      const brandPool = brand ? candidates.filter((c) => (c.productName ?? '').includes(brand)) : [];
      const pool = brandPool.length > 0 ? brandPool : candidates;
      const { candidate: best, hits, tokenCount } = pickByNameSimilarity(input.searchKeyword, pool);
      const bestName = best.productName ?? '';
      // 폐기 조건: 0 토큰 겹침, 또는 **브랜드가 매칭 상품에 없음**(색상 같은 부수 단어 하나로 통과한
      //   다른 브랜드 오매칭). 상품명을 명시했는데 브랜드가 안 맞으면 게시 계정에 다른 브랜드가 나감.
      //   폐기여도 즉시 포기 X — 키워드를 줄여 재검색(브랜드 상품이 top 밖에 밀린 경우 구제).
      const brandPresent = Boolean(brand && bestName.includes(brand));
      if (hits === 0 || !brandPresent) {
        logger.warn(
          { keyword, matched: bestName, hits, brand, brandPresent, attempts },
          'trustKeyword: 브랜드 불일치 — 키워드 축소 재시도',
        );
        if (attempts < maxAttempts && keyword.split(/\s+/).length > 1) {
          keyword = broadenKeyword(keyword);
          continue;
        }
        return { success: false, reason: 'no-candidates', attempts };
      }
      let deeplinkUrl: string;
      try {
        deeplinkUrl = await primary.generateDeeplink(best.productUrl);
      } catch (err) {
        logger.error({ err, product: best.productName }, 'deeplink 생성 실패 (trusted)');
        return { success: false, reason: 'error', attempts };
      }
      // 겹친 토큰 비율을 신뢰도로 (가짜 1.0 대신 실제 유사도 노출 → 승인 카드에서 판단 근거)
      const visionScore = Math.min(1, hits / Math.max(1, tokenCount));
      logger.info({ candidate: best.productName, keyword: input.searchKeyword, hits, tokenCount, visionScore, trusted: true }, 'match by trusted keyword (name-similar)');
      return {
        success: true,
        result: { channel: primary.channel, product: best, visionScore, attempts, deeplinkUrl },
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
function pickByNameSimilarity(
  keyword: string,
  candidates: CommerceSearchResult[],
): { candidate: CommerceSearchResult; hits: number; tokenCount: number } {
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
  return { candidate: best, hits: Math.max(0, bestScore), tokenCount: kwTokens.length };
}

/**
 * 검색어에서 쿠팡 관련도를 망치는 노이즈 토큰 제거 — 상품코드(OAP97A4S·IF6184·TFI-80053),
 * 순수 숫자·용량(2.5), 단위(g·ml·kg). 브랜드·품목·색상 같은 실단어만 남긴다.
 * (유사도 판정엔 원본을 쓰므로 여기선 '검색 쿼리'만 정제.)
 */
function stripSearchNoise(keyword: string): string {
  const tokens = keyword.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => {
    if (/^\d+(?:[.,]\d+)?$/.test(t)) return false; // 순수 숫자·용량 "2.5"
    if (/^(?:g|kg|mg|ml|l|oz|cm|mm)$/i.test(t)) return false; // 단위
    if (t.length >= 4 && /[A-Za-z]/.test(t) && /\d/.test(t)) return false; // SKU 코드 (영문+숫자 혼합)
    return true;
  });
  return kept.length >= 1 ? kept.join(' ') : keyword;
}

function broadenKeyword(keyword: string): string {
  // 간단한 키워드 확장: 마지막 수식어 제거 or 일반화
  const words = keyword.split(/\s+/);
  if (words.length > 1) return words.slice(0, -1).join(' ');
  return keyword;
}
