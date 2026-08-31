/**
 * 페르소나 프리뷰 전용 wrapper.
 * 상품/이미지/deeplink 없이도 sourceText만으로 카피 생성 가능하게 노출.
 */
import { llm } from '../../../infra/llm/index.js';
import { z } from 'zod';

const BodyResultSchema = z.object({
  body: z.string().min(6).max(200),
});

const NEUTRAL_PERSONA =
  '한국 Threads 사용자. 담백한 구어체. 특정 성별·연령대 지향 없음. 이모지 절제.';

const UNIVERSAL_PRINCIPLES = `너는 한국 Threads 피드에 자연스럽게 섞일 짧은 게시글 한 문장을 만드는 도구다.

플랫폼 규칙:
- 문장 1개, 최대 2~3줄, 대략 18~80자 (넘어가도 150자 이내).
- 광고 카피처럼 보이면 안 됨. 친구가 툭 던진 느낌.
- 브랜드명·제품명·가격·구매 링크 언급 금지.
- 제품 스펙·성분·기능 나열 금지.

원본 처리 원칙:
- 원본은 소재·훅만 참고. 직역 금지.
- 원본 감정·상황을 잡아서 페르소나 톤으로 완전히 새로 작성.

출력 포맷: JSON only. { "body": "본문" }`;

export interface PreviewInput {
  sourceText: string;
  sourceLanguage?: string | null;
  productName?: string;
  personaPrompt?: string;
  accountSeed: string;
}

export async function generateBody(input: PreviewInput): Promise<string> {
  const persona = input.personaPrompt?.trim() || NEUTRAL_PERSONA;
  const langHint = input.sourceLanguage
    ? `\n\n원본 감지 언어: ${input.sourceLanguage} (직역 금지, 페르소나로 재창조)`
    : '';

  const system = `${UNIVERSAL_PRINCIPLES}

== 페르소나 (seed=${input.accountSeed}) ==
${persona}

이 페르소나는 톤·타겟의 유일한 기준이다.${langHint}`;

  const userText = [
    `원본:\n"""\n${input.sourceText}\n"""`,
    input.productName ? `참고 상품명(카피 노출 금지): ${input.productName}` : '',
    '본문 1개 JSON으로.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await llm().complete({
    tier: 'main',
    system,
    userParts: [{ type: 'text', text: userText }],
    maxOutputTokens: 512,
    temperature: 0.9,
    jsonMode: true,
    jsonSchema: {
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
    },
  });

  const stripped = response.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  const jsonStr = start !== -1 && end !== -1 ? stripped.slice(start, end + 1) : stripped;
  const parsed = JSON.parse(jsonStr);
  return BodyResultSchema.parse(parsed).body;
}
