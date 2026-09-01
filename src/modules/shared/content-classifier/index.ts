import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';

// CLAUDE.md §2 Pipeline A - Step 2: 소비재 적합성 필터링 + 카테고리 + 검색 키워드

export const CATEGORIES = [
  '의류',
  '신발',
  '패션잡화',
  '뷰티',
  '생활용품',
  '가전',
  '식품',
  '기타',
] as const;
export type Category = (typeof CATEGORIES)[number];

const ClassifyResultSchema = z.object({
  suitable: z.boolean(),
  category: z.enum(CATEGORIES).optional(),
  searchKeyword: z.string().min(1).max(30).optional(),
  reason: z.string().optional(),
});

export type ClassifyResult = z.infer<typeof ClassifyResultSchema>;

const SYSTEM_PROMPT = `당신은 쇼핑 큐레이션 파이프라인의 필터/추출 노드입니다.

입력: 해외 소셜미디어(Threads/X)의 원문 텍스트와 이미지 URL 목록.
목표: 한국 쿠팡/무신사에서 판매 가능한 일반 소비재/생활용품/패션 아이템을 소개하는 콘텐츠인지 판정하고, 매칭 가능한 단일 표준 검색 키워드를 뽑는다.

부적합 예시(반드시 suitable=false):
- 정치/종교/성인/의약품/총기/도박/투자상품
- 서비스(여행지, 앱, 강의)
- 개인 브랜딩/자기 홍보 게시물 (구체적 상품 미언급)
- 상품 특정 불가능 (일반적 감상, 밈)
- 국내 유통 불가능 (규제 품목, 초저가 위조품 의심)

적합 판정 시:
- category: 다음 중 하나만 [의류, 신발, 패션잡화, 뷰티, 생활용품, 가전, 식품, 기타]
- searchKeyword: 한국어 표준 상품명 1개 (2~5단어). 브랜드명 지양, 일반 명사 위주. 쿠팡/무신사 검색창에 그대로 넣어 매칭될 표현.

JSON 스키마로만 응답 (다른 텍스트 금지):
{
  "suitable": boolean,
  "category": string | undefined,
  "searchKeyword": string | undefined,
  "reason": string | undefined
}`;

export interface ClassifyInput {
  text: string;
  mediaUrls: string[];
}

/**
 * 3-tier 콘텐츠 성격 분류.
 *
 * SHOPPING: 상품 소개/추천/구매 유도가 목적 (Pipeline A)
 * DAILY: 재미·트렌드·이슈·개인 생활 · 특정 상품 없음 (Pipeline C)
 * UNSUITABLE: 정치·성인·개인 홍보·의약품·투자 등 저장·발행 부적합
 */
export const CONTENT_TYPES = ['SHOPPING', 'DAILY', 'UNSUITABLE'] as const;
export type ContentTypeTag = (typeof CONTENT_TYPES)[number];

export interface ContentTypeResult {
  contentType: ContentTypeTag;
  reason: string;
}

const CONTENT_TYPE_PROMPT = `너는 SNS 게시글의 성격을 3가지로 분류하는 라우터다.

분류:
- SHOPPING : 특정 상품/브랜드 소개, 추천, 구매 유도, 사용 후기, 언박싱, 쇼핑 큐레이션.
             상품이 명시적으로 나오고 독자에게 "이거 좋다/살만하다" 느낌을 준다.
- DAILY    : 일상 · 재미 · 트렌드 · 이슈 · 유머 · 관찰 · 뉴스 반응 · 개인 감상 · 유명인 화제 등.
             특정 상품이 없거나, 있어도 부수적 (예: "카페 왔는데 커피 맛있다" — 카페 언급이 목적 아님).
             주제어(예: "마운자로", "다이어트약")가 잠깐 언급돼도 게시글의 **주된 의도**가
             일상 관찰·궁금증·감상이면 DAILY.
- UNSUITABLE : 게시글의 **주된 의도**가 아래에 해당할 때만.
             · 정치 견해·선거·특정 정치인 옹호/비판
             · 종교 교리·개종 유도
             · 성인 · 노출 · 성적 콘텐츠
             · 의약품·건강기능식품의 **판매·직접 추천·복용 후기** (단순 언급은 제외)
             · 투자 상품 (주식·코인·부동산) 매매 유도
             · 도박·베팅
             · 개인 사업·강의·컨설팅 판매 홍보
             · 특정 인물 저격·명예훼손·차별
             · 소셜 이슈 논쟁성 게시물

판정 원칙: 애매하면 DAILY. UNSUITABLE 은 명확한 판매·주장·유도 있을 때만.

JSON 오브젝트로만 반환:
{ "contentType": "SHOPPING" | "DAILY" | "UNSUITABLE", "reason": "1문장 판단 근거 (한국어)" }`;

export async function classifyContentType(input: {
  text: string;
  mediaUrls?: string[];
}): Promise<ContentTypeResult> {
  const userParts: LlmContentPart[] = [];
  for (const url of (input.mediaUrls ?? []).slice(0, 2)) {
    userParts.push({ type: 'image', url });
  }
  userParts.push({
    type: 'text',
    text: `게시글:\n"""\n${input.text}\n"""\n\n분류 결과를 JSON으로만 반환.`,
  });

  const response = await llm().complete({
    tier: 'fast',
    system: CONTENT_TYPE_PROMPT,
    userParts,
    maxOutputTokens: 200,
    temperature: 0.1,
    jsonMode: true,
    jsonSchema: {
      type: 'object',
      properties: {
        contentType: { type: 'string', enum: [...CONTENT_TYPES] },
        reason: { type: 'string', maxLength: 200 },
      },
      required: ['contentType', 'reason'],
    },
  });

  const parsed = extractJson(response.text) as Record<string, unknown>;
  const ct = typeof parsed.contentType === 'string' && (CONTENT_TYPES as readonly string[]).includes(parsed.contentType)
    ? (parsed.contentType as ContentTypeTag)
    : 'DAILY';
  const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '';
  return { contentType: ct, reason };
}

export async function classifySourceItem(input: ClassifyInput): Promise<ClassifyResult> {
  const userParts: LlmContentPart[] = [];

  for (const url of input.mediaUrls.slice(0, 4)) {
    userParts.push({ type: 'image', url });
  }
  userParts.push({
    type: 'text',
    text: `원문:\n"""\n${input.text}\n"""\n\n판정 결과를 JSON으로만 반환.`,
  });

  const response = await llm().complete({
    tier: 'fast',
    system: SYSTEM_PROMPT,
    userParts,
    maxOutputTokens: 512,
    jsonMode: true,
    jsonSchema: {
      type: 'object',
      properties: {
        suitable: { type: 'boolean' },
        category: { type: 'string', enum: [...CATEGORIES] },
        searchKeyword: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['suitable'],
    },
  });

  const parsed = extractJson(response.text);
  const result = ClassifyResultSchema.parse(parsed);
  logger.debug({ result, provider: response.provider }, 'classifySourceItem');
  return result;
}

function extractJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error(`no JSON in response: ${stripped.slice(0, 200)}`);
    return JSON.parse(stripped.slice(start, end + 1));
  }
}
