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

const SYSTEM_PROMPT = `너는 트렌드 신호를 우리 5개 페르소나의 SNS 쇼핑 콘텐츠용으로 정제하는 필터다.

우리 페르소나 5명이 다루는 소재 (이 범위 안이어야 keep):
- 30대 남 자취 IT: 자취템(주방소품·청소기·전기용품), 간편식·밀키트, 홈헬스(덤벨·매트),
  데스크셋업(모니터암·키보드), 카페인·커피용품, 게이밍 주변기기
- 30대 여 유아맘 워킹맘: 주방 시간 절약템(에어프라이어·밀프렙), 유아 간식·건강식,
  정리수납·청소, 가벼운 뷰티(자외선차단·기초), 워킹맘 생존템(도시락통·보온병·백팩)
- 20대 여 감성 마케팅: 뷰티(스킨케어·향수·립), 감성 인테리어(무드등·러그·오브제),
  카페 원두·티, 액세서리, 미니멀 패션
- 20대 여 3교대 홈트: 홈트·요가매트·짐볼, 다이어트 식품(오트밀·닭가슴살·프로틴),
  자취 냉장고 정리·저칼로리 밀키트, 이너케어·유산균, 미니 스텝퍼
- 40대 여 워킹맘 실용: 실속 주방(밥솥·냄비), 자녀 학습·간식, 정리수납,
  가족 일반 건강기능식(유산균·오메가3), 부모님 선물템

각 신호에 대해 판정:
1) keep: 아래 3가지 조건을 모두 만족?
   (a) 우리 페르소나 소재와 매칭
   (b) **여성 또는 중성 대상** (남성 특화 X — 남성 헤어밴드·남자 손목시계·남자 골프용품 등 배제)
   (c) **트렌드성·감각·신상 요소 있음** (평범한 실용템 X — 양말·쿨토시·마스크·러닝벨트·자외선차단·수선패드 등
       매일 쓰는 흔한 것은 SNS 콘텐츠 훅으로 약함)

   자동 drop 대상:
   - 정치·시사·인물·스포츠·TV 프로 · 뉴스 이슈 · 투자 · 성인 · 의약품
   - 김치·반찬·전통음식 · 자동차 · 부동산 · 성인 취미
   - 남성 특화 (남자 신발·남자 시계·남자 운동복 등)
   - 평범 실용템 (양말·쿨토시·마스크·수선용품·러닝벨트·헤어밴드 등)

   keep 대상:
   - 여성/중성 신상·예쁜 것·감각적인 것
     예: 신상 운동화, 트렌디한 가방, 감성 인테리어, 최근 화제 뷰티템
   - 밈성·바이럴 요소 있는 것

2) searchKeyword (keep=true 시): SNS 검색용 짧은 한국어 키워드
   - "예쁜 운동화 신상" 같은 감각 수식어 유지
   - 브랜드명이 트렌디하면 유지 (아디다스 삼바·나이키 코르테즈 등)
   - 2~4음절 or 5~15자
3) category: fashion·beauty·kitchen·home·health·food·baby_kids·tech·lifestyle 중
4) reason: 판정 이유 (1문장)

애매하면 keep=false. 실용템·남성템·평범한 것은 과감히 drop.

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
