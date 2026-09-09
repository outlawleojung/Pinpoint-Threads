import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { buildSearchTermPool } from '../../../infra/naver/autocomplete.js';

/**
 * 실수요 수집·주제 선정.
 * 원칙: 주제·앵글을 "상상"이 아니라 네이버 자동완성(실제 검색어)에서 뽑는다.
 */

// 정보 니즈가 뚜렷한(문제·질문형) 검색어 신호 — 가중치 부여용.
const NEED_SIGNALS = /버리는|버리기|분리수거|재활용|깨짐|깨지|안\s*깨|되나|사용법|사용|여는\s*법|여는법|고르는|고르기|추천|어디|비교|차이|후기|방법|팁|세척|보관|정리|수납|처리|막힘|냄새|제거|고장|해결/;
// 상품 연결성 신호 → AFFILIATE 성향.
const BUY_SIGNALS = /추천|다이소|가성비|브랜드|세트|최저가/;

// 팩트 취약(실시간·지역·개인 사실) 주제 — LLM이 지어내므로 자동 생성에서 배제.
// 지명/매장/위치, 가격/비용/시세, 신청/절차/행정, 자격증/취업 류.
const FACT_FRAGILE =
  /어디|매장|샵|가게|위치|근처|동네|투어|지점|주소|전화|번호|영업시간|오픈시간|가격|얼마|비용|시세|시급|월급|연봉|신청|접수|과태료|수수료|자격증|학원|취업|창업|맛집|병원|후기/;

/** 팩트 취약 주제인지(지명·가격·절차·자격 등 LLM이 확인 못 하는 실사실 요구). */
export function isFactFragile(term: string): boolean {
  return FACT_FRAGILE.test(term);
}

export interface DemandTopic {
  query: string;       // 선택된 실제 검색어(주제 축)
  angle: string;       // 그 검색 의도에 정확히 답하는 글 주제 한 줄
  intent: 'INFO' | 'AFFILIATE';
  pool: string[];      // 참고용 실수요 풀
}

/** 여러 시드의 자동완성 2-hop 풀을 모아 정보 니즈 강한 순으로 정렬. */
export async function harvestDemand(seeds: string[]): Promise<string[]> {
  const pools = await Promise.all(seeds.map((s) => buildSearchTermPool(s, { drill: 3, max: 25 })));
  const seen = new Set<string>();
  const all: string[] = [];
  for (const p of pools) for (const t of p) if (!seen.has(t)) { seen.add(t); all.push(t); }
  // 문제/질문형 우선, 그 안에서 길이 짧은(핵심) 순.
  return all.sort((a, b) => {
    const sa = NEED_SIGNALS.test(a) ? 1 : 0;
    const sb = NEED_SIGNALS.test(b) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return a.length - b.length;
  });
}

/**
 * 실수요 풀에서 최근 발행분과 겹치지 않는 날카로운 쿼리 하나를 골라,
 * 그 검색 의도에 정확히 답하는 글 앵글 한 줄로 만든다(검색어에서 벗어나 일반화 금지).
 */
export async function selectDemandTopic(opts: {
  category: string;
  seeds: string[];
  recentTitles: string[];
}): Promise<DemandTopic | null> {
  const pool = await harvestDemand(opts.seeds);
  if (pool.length === 0) return null;

  // 팩트 취약(지명·가격·절차·자격) 쿼리 제거 → 에버그린 노하우만 남긴다.
  const safe = pool.filter((t) => !isFactFragile(t));
  // 니즈 신호가 있는 쿼리 우선 후보(없으면 상위 일반).
  const candidates = safe.filter((t) => NEED_SIGNALS.test(t)).slice(0, 20);
  const shortlist = (candidates.length ? candidates : safe).slice(0, 20);
  if (shortlist.length === 0) return null;

  const system =
    '너는 네이버 실제 검색어 목록에서 "지금 글로 쓰면 사람들이 실제로 검색해서 들어올" 딱 하나의 주제를 고르는 도구다. ' +
    '반드시 주어진 검색어에 뿌리를 두고, 그 검색 의도(사람들이 진짜 알고 싶은 것)에 정확히 답하는 구체적 주제로 만든다. ' +
    '검색어에서 벗어나 일반화("~고르는 법 총정리")하지 마라. 최근 발행 주제와 겹치면 다른 것을 골라라. ' +
    '⚠️ 절대 금지: 특정 장소·지명·매장·영업시간·가격/시세·신청 절차·자격증/취업처럼 "그때그때 확인해야 아는 실시간·지역 사실"이 필요한 주제. ' +
    '이런 건 확인할 수 없어 틀린 정보를 쓰게 된다. 대신 방법·기준·원리·배치·관리·비교처럼 "언제 어디서나 통하는 노하우" 주제만 골라라. ' +
    '출력은 순수 JSON: {"query":"고른 검색어","angle":"그 의도에 답하는 글 주제 한 줄"} — 다른 텍스트 금지.';
  const user =
    `카테고리: ${opts.category}\n` +
    `실제 검색어 후보:\n- ${shortlist.join('\n- ')}\n\n` +
    (opts.recentTitles.length ? `최근 발행(겹치지 말 것):\n- ${opts.recentTitles.join('\n- ')}\n\n` : '') +
    '가장 정보 니즈가 뚜렷한 검색어 하나를 골라 angle로.';

  try {
    const res = await llm().complete({
      tier: 'main', system, jsonMode: true, temperature: 0.5, maxOutputTokens: 300, thinking: 'disabled',
      userParts: [{ type: 'text', text: user }],
    });
    const m = res.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { query?: string; angle?: string };
    const query = (parsed.query ?? '').trim();
    const angle = (parsed.angle ?? '').trim();
    if (!angle) return null;
    const intent: 'INFO' | 'AFFILIATE' = BUY_SIGNALS.test(query) ? 'AFFILIATE' : 'INFO';
    return { query, angle, intent, pool: shortlist };
  } catch (err) {
    logger.warn({ err: (err as Error).message, category: opts.category }, 'selectDemandTopic 실패');
    return null;
  }
}
