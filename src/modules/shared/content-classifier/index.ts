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
