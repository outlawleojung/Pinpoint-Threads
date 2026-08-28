import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { anthropic, MODELS } from '../../../infra/anthropic-client.js';
import { logger } from '../../../config/logger.js';

/**
 * "쿠파스 게시글 생성기" Custom GPT 스타일을 이식한 카피 노드.
 *
 * 핵심 설계:
 * - 본문(body): 이미지 1장 기반 짧은 한 문장 (18~60자, 최대 2줄).
 *   광고 티 없이 "친구가 방금 겪은 일" 톤. 링크/브랜드/가격/구매처/홍보 표현 금지.
 * - 고정 댓글(reply): 결정론적 템플릿으로 조립 (AI 미개입).
 *   "정보 물어보시는 분들 많아서 링크 남겨요" + 딥링크 + 공정위 필수 문구.
 */

export const LEGAL_DISCLAIMER =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

const BodyResultSchema = z.object({
  body: z.string().min(6).max(80),
});

export type CopywriteResult = {
  body: string;
  reply: string;
};

export interface CopywriteInput {
  sourceText?: string;
  sourceImageUrl: string;
  productName: string;
  productCategory?: string;
  personaPrompt?: string;
  accountSeed: string;
  deeplinkUrl: string;
  channel: 'COUPANG' | 'MUSINSA';
  variantCount?: number;
}

const BASE_SYSTEM_PROMPT = `너는 한국 Threads 피드에 자연스럽게 섞일 짧은 게시글 한 문장을 만드는 도구다.

핵심 원칙:
- 이미지 1장 기반, 문장 1개, 최대 2줄, 대략 18~45자 (넘어가도 60자 이내).
- 제목/설명/해설/해시태그/부연 코멘트 절대 금지. 오로지 문장 1개만 출력.
- 광고 카피처럼 보이면 안 됨. 친구가 방금 겪은 일을 툭 던진 느낌.
- 제품·성능·성분·스펙·기능 설명 금지. 상황·행동·감정·발견 중심.
- 브랜드명·제품명·모델명·가격·할인·최저가·구매처·구매 링크 언급 금지.
- 로고가 보여도 브랜드명 꺼내지 않음.

문체:
- 한국어 반말 + 인터넷 구어체.
- 어미 예: ~임 / ~했음 / ~네 / ~냐 / ~지? / ~였네 / ~아니지?
- 이모지는 안 쓰거나 최대 1개. 지나친 감성/은유/시적 표현 금지.
- ㅋㅋ, ㄷㄷ, ;; 등 인터넷 표현은 필요할 때만 가볍게.

금지 어휘:
- 강추, 추천, 가성비, 혜자, 필수템, 존예, 미쳤다, 갓템, 인생템,
  최저가, 할인, 무료배송, 리뷰, 후기, 사용법, 스펙 등 홍보/후기 냄새 나는 단어.

권장 문장 구조 (참고, 강제 아님):
- 상황 → 깨달음: "~인 줄 알았는데 ~였네"
- 실수/사건 → 감정: "방금 ~하고 현타 옴"
- 공감 유도: "이거 나만 그랬냐…"
- 궁금증 질문: "이거 해본 사람 있음?"
- 미완의 결론: "별거 아닌데 이게 은근 스트레스였음"

출력 포맷:
JSON으로만 반환. 다른 텍스트 금지.
{ "body": "여기에 문장 1개" }`;

type UserContent = Array<
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } }
>;

async function generateBody(input: CopywriteInput, seedIndex: number): Promise<string> {
  const persona = input.personaPrompt
    ? `\n\n== 이 계정의 페르소나 (seed=${input.accountSeed}, variant=${seedIndex}) ==\n${input.personaPrompt}`
    : '';
  const system = BASE_SYSTEM_PROMPT + persona;

  const userContent: UserContent = [
    { type: 'image', source: { type: 'url', url: input.sourceImageUrl } },
  ];
  if (input.sourceText) {
    userContent.push({
      type: 'text',
      text: `참고 원문(문장 참고용, 그대로 옮기지 말 것):\n"""\n${input.sourceText}\n"""`,
    });
  }
  userContent.push({
    type: 'text',
    text: `상품 카테고리 참고: ${input.productCategory ?? '알 수 없음'}\n\n이미지 기반으로 문장 1개만 JSON으로.`,
  });

  const response = await anthropic.messages.create({
    model: MODELS.SONNET,
    max_tokens: 256,
    system,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: userContent as any }],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('no text block in copywriter response');
  const raw = block.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(raw);
  const { body } = BodyResultSchema.parse(parsed);
  return body;
}

/**
 * 고정 댓글은 AI 없이 결정론적 템플릿.
 * CLAUDE.md §4.3 법적 필수 문구 강제.
 */
export function buildReply(deeplinkUrl: string): string {
  return [
    '정보 물어보시는 분들 많아서 링크 남겨요 🙌',
    deeplinkUrl,
    '',
    LEGAL_DISCLAIMER,
  ].join('\n');
}

export async function generateCopy(input: CopywriteInput): Promise<CopywriteResult> {
  const body = await generateBody(input, 0);
  const reply = buildReply(input.deeplinkUrl);
  const result: CopywriteResult = { body, reply };
  logger.debug({ result }, 'generateCopy');
  return result;
}

/**
 * 재생성 요청 시 여러 후보를 한 번에.
 * "쿠파스 게시글 생성기"가 피드백 시 보통 3개 후보를 다시 주는 패턴을 반영.
 */
export async function generateBodyVariants(
  input: CopywriteInput,
  count = 3,
): Promise<string[]> {
  const variants: string[] = [];
  for (let i = 0; i < count; i++) {
    variants.push(await generateBody(input, i));
  }
  return variants;
}
