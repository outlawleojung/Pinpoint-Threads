import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';

// Pipeline A - Step 3: 원본 미디어 vs 커머스 썸네일 정합성 Vision 검증

const VisionMatchResultSchema = z.object({
  matched: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string().optional(),
});

export type VisionMatchResult = z.infer<typeof VisionMatchResultSchema>;

const SYSTEM_PROMPT = `당신은 상품 이미지 정합성 판정 노드다.
목표: 이미지 B(쇼핑 상품)가 이미지 A(원본 게시물)에 나온 **그 상품과 같은 상품인가** — 종류뿐 아니라 **색상·핵심 변형까지** 같아야 한다.

두 축을 모두 본다:
1) 종류/형태 — 같은 카테고리·실루엣·주요 특징 (스니커즈↔스니커즈, 방향제↔방향제).
2) **색상/변형 — 눈에 띄는 주된 색과 핵심 변형이 일치해야 한다.**
   종류가 같아도 **주된 색이 확연히 다르면(회색 vs 베이지, 블랙 vs 화이트) 다른 상품으로 취급.**
   단, 조명·각도로 인한 미세한 색조 차이는 감점하지 마라(주된 색 계열이 같으면 OK).

score 산정 (둘 다 반영):
- 종류부터 다름 → 0 ~ 0.3
- **종류 같으나 색/핵심변형 확연히 다름 → 0.4 ~ 0.6 (matched=false)**  ← "색상만 다를 뿐" 은 여기
- 종류 같고 색·변형도 일치 → 0.85 ~ 1.0 (matched=true)

matched = (종류 일치 AND 주된 색·변형 일치). 애매하면 낮게.

JSON으로만 반환 (다른 텍스트 금지):
{ "matched": boolean, "score": number, "reason": string }`;

export interface VisionMatchInput {
  sourceImageUrl: string;
  productThumbnailUrl: string;
}

export async function verifyProductMatch(input: VisionMatchInput): Promise<VisionMatchResult> {
  const userParts: LlmContentPart[] = [
    { type: 'text', text: '이미지 A: 원본 소셜미디어 게시물' },
    { type: 'image', url: input.sourceImageUrl },
    { type: 'text', text: '이미지 B: 쿠팡/무신사 상품 썸네일' },
    { type: 'image', url: input.productThumbnailUrl },
    { type: 'text', text: '두 이미지를 비교해 JSON으로만 판정하세요.' },
  ];

  const response = await llm().complete({
    tier: 'main',
    system: SYSTEM_PROMPT,
    userParts,
    maxOutputTokens: 512,
    temperature: 0.2,
    jsonMode: true,
    jsonSchema: {
      type: 'object',
      properties: {
        matched: { type: 'boolean' },
        score: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['matched', 'score'],
    },
  });

  const parsed = extractJson(response.text);
  const result = VisionMatchResultSchema.parse(parsed);
  logger.debug({ result, provider: response.provider }, 'verifyProductMatch');
  return result;
}

function extractJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/:\s*undefined\b/g, ': null')
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
