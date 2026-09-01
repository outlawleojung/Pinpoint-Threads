import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import type { RawTrendSignal } from './index.js';

/**
 * 트렌드 신호 필터·정제.
 *
 * 두 가지 문제 해결:
 *   1) Google Trends는 상위 90%가 정치·인물·스포츠 → 쇼핑 무관 → 필터.
 *   2) Coupang 상품명은 너무 좁음 ("이지뷰 리퀴드 수경용 안티포그 김 서림 방지 용액")
 *      → 검색 액터에서 0건 → 일반 검색 키워드로 압축 ("김서림방지").
 *
 * Claude 1회 호출로 배치 처리 (신호 20개당 ~$0.001).
 */

const CATEGORIES = [
  'beauty', 'fashion', 'kitchen', 'home', 'health', 'food',
  'baby_kids', 'parenting', 'pet', 'tech', 'travel',
  'lifestyle', 'shopping_review', 'other',
] as const;
type FilterCategory = (typeof CATEGORIES)[number];

const FilteredSignalSchema = z.object({
  originalIndex: z.number().int(),
  keep: z.boolean(),
  searchKeyword: z.string().min(1).max(30).optional(),
  category: z.string().max(40).optional(), // Claude가 한국어 카테고리 반환하기도 함 — 우선 그대로 저장
  reason: z.string().max(200).optional(),
});
export type FilteredSignal = z.infer<typeof FilteredSignalSchema>;

export interface FilteredResult {
  original: RawTrendSignal;
  keep: boolean;
  searchKeyword?: string;
  category?: FilterCategory;
  reason?: string;
}

const SYSTEM_PROMPT = `너는 트렌드 신호를 SNS 쇼핑 콘텐츠용으로 정제하는 필터다.

각 신호(키워드 또는 상품명)에 대해 판정:
1) keep: 이 신호로 SNS 쇼핑 콘텐츠 발굴이 가능한가?
   - false: 정치인·연예인 이름, 스포츠 경기·팀, 시사·사건·사고, 특정 인물 논쟁,
           TV 프로그램 방영 관련, 기업 주가·투자, 일반 뉴스 이슈
   - true: 상품·소비재·라이프스타일·식품·뷰티·패션·건강·주방·홈·여행·펫 등
2) searchKeyword (keep=true 시): 이 신호를 SNS(Threads/IG) 검색에 넣을 짧은 한국어 키워드
   - 상품명이 길고 구체적이면 → 일반 카테고리로 압축
     예: "이지뷰 리퀴드 수경용 안티포그 김 서림 방지 용액" → "김서림방지"
     예: "케이투세이프티 심리스 쿨토시" → "쿨토시"
   - 이미 짧고 검색가능하면 → 그대로
   - 브랜드명 유지 여부: 유명 브랜드는 유지 OK, 무명은 제거
   - 2~4음절 or 5~15자 이내
3) category: 페르소나 매칭용
4) reason: 판정 이유 (1문장)

JSON 배열로만 반환. 원본 인덱스(0부터) 유지.`;

export async function filterAndGeneralize(
  signals: RawTrendSignal[],
): Promise<FilteredResult[]> {
  if (!signals.length) return [];

  // Claude에 원본 인덱스와 함께 보냄
  const listing = signals
    .map((s, i) => `${i}. [${s.source}] ${s.keyword}`)
    .join('\n');

  const response = await llm().complete({
    tier: 'fast',
    system: SYSTEM_PROMPT,
    userParts: [
      {
        type: 'text',
        text: `아래 ${signals.length}개 신호를 판정하라. JSON 배열로 각 신호에 대한 판정 반환:\n\n${listing}\n\n출력: [{originalIndex, keep, searchKeyword?, category?, reason?}]`,
      },
    ],
    maxOutputTokens: Math.min(8000, 500 + signals.length * 120),
    temperature: 0.2,
    jsonMode: true,
  });

  const parsed = extractJsonArray(response.text);
  logger.debug({ rawLen: response.text.length, first500: response.text.slice(0, 500), parsedCount: parsed.length, sample: parsed[0] }, 'filter LLM raw');
  const items: FilteredSignal[] = [];
  const failed: unknown[] = [];
  for (const raw of parsed) {
    const validated = FilteredSignalSchema.safeParse(raw);
    if (validated.success) items.push(validated.data);
    else failed.push({ raw, err: validated.error.issues[0]?.message });
  }
  if (failed.length) {
    logger.warn({ failedCount: failed.length, firstFail: failed[0] }, 'filter validation drops');
  }

  // 원본 인덱스로 매핑
  const resultMap = new Map<number, FilteredSignal>();
  for (const it of items) resultMap.set(it.originalIndex, it);

  const results: FilteredResult[] = signals.map((original, i) => {
    const decision = resultMap.get(i);
    if (!decision) {
      return { original, keep: false, reason: 'LLM 판정 누락 → 안전 drop' };
    }
    return {
      original,
      keep: decision.keep,
      searchKeyword: decision.searchKeyword,
      category: decision.category as FilterCategory | undefined,
      reason: decision.reason,
    };
  });

  const kept = results.filter((r) => r.keep).length;
  logger.info(
    { total: signals.length, kept, dropped: signals.length - kept },
    'trend signals filtered',
  );
  return results;
}

function extractJsonArray(raw: string): unknown[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    // 객체로 감싸져 나올 수도 있음 (Claude가 {"items": [...]} 반환)
    if (parsed && typeof parsed === 'object') {
      for (const v of Object.values(parsed)) {
        if (Array.isArray(v)) return v;
      }
    }
    return [];
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return [];
    }
  }
}
