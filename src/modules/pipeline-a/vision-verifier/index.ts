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

const SYSTEM_PROMPT = `당신은 이미지 비교 판정 노드입니다.

두 이미지를 비교하여, 같은 카테고리·같은 형태·비슷한 용도의 상품인지 판정합니다.
완전히 동일 제품일 필요는 없습니다. 다음 조건을 만족하면 matched=true:
- 상품 카테고리가 일치 (예: 가습기 ↔ 가습기, 티셔츠 ↔ 티셔츠)
- 전체 형태·비례·주요 특징이 유사
- 소비자가 봤을 때 "같은 종류의 물건"으로 인식 가능

matched=false 예:
- 카테고리 다름 (가습기 vs 공기청정기)
- 형태 완전 다름 (탁상용 vs 스탠드형)
- 용도 다름 (아동용 vs 성인용)

score: 0(전혀 다름) ~ 1(완전 일치) 사이 실수.
threshold: score >= 0.65 이면 matched=true 권장.

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
