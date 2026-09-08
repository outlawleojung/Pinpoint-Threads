import { logger } from '../../config/logger.js';

/**
 * 네이버 검색 자동완성(연관검색어) — 사람들이 실제로 검색하는 키워드를 얻는다.
 *
 * 비공식 엔드포인트(ac.search.naver.com). 인증 불필요·무료.
 * 응답: { items: [ [ ["수납정리함","0"], ["옷 수납정리함","0"], ... ] ] }
 * 실패 시 항상 [] 반환(throw 안 함) — 호출측은 에버그린으로 폴백.
 */
const AC_URL = 'https://ac.search.naver.com/nx/ac';

export async function fetchAutocomplete(seed: string, opts?: { max?: number }): Promise<string[]> {
  const max = opts?.max ?? 10;
  const q = seed.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    q,
    con: '1',
    frm: 'nv',
    ans: '2',
    r_format: 'json',
    r_enc: 'UTF-8',
    r_unicode: '0',
    t_koreng: '1',
    run: '2',
    rev: '4',
    q_enc: 'UTF-8',
    st: '100',
  });

  try {
    const res = await fetch(`${AC_URL}?${params.toString()}`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        referer: 'https://www.naver.com/',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, seed }, '네이버 자동완성 non-OK');
      return [];
    }
    const json = (await res.json()) as { items?: unknown };
    const groups = Array.isArray(json.items) ? json.items : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      for (const row of group) {
        const term = Array.isArray(row) ? row[0] : undefined;
        if (typeof term === 'string') {
          const t = term.trim();
          if (t && t !== q && !seen.has(t)) {
            seen.add(t);
            out.push(t);
          }
        }
      }
    }
    return out.slice(0, max);
  } catch (err) {
    logger.warn({ err: (err as Error).message, seed }, '네이버 자동완성 실패');
    return [];
  }
}

/**
 * 씨앗어의 자동완성 + 그 결과 상위 몇 개를 한 단계 더 확장(드릴다운)해
 * "사람들이 실제 검색하는 주제 풀"을 넓게 모은다.
 */
export async function buildSearchTermPool(seed: string, opts?: { drill?: number; max?: number }): Promise<string[]> {
  const drill = opts?.drill ?? 3;
  const max = opts?.max ?? 25;
  const first = await fetchAutocomplete(seed, { max: 10 });
  const seen = new Set<string>(first);
  const pool = [...first];
  for (const term of first.slice(0, drill)) {
    const more = await fetchAutocomplete(term, { max: 6 });
    for (const m of more) {
      if (!seen.has(m)) {
        seen.add(m);
        pool.push(m);
      }
    }
  }
  return pool.slice(0, max);
}
