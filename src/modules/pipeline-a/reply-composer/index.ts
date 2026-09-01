import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';

/**
 * Reply Composer (고정 댓글).
 * Pipeline A 발행 시 본문 밑에 자기 댓글로 즉시 다는 고정 댓글 조립.
 *
 * 설계 (사용자 방침 확정, 2026-08-28):
 * - AI가 상품·본문 맥락에 맞춰 "툭 던지는 감초 같은 한 마디" 생성
 * - 광고 티 안 나게 자연스럽게
 * - 실전 4양식은 유지 안 함 (상품 성격과 톤 불일치 잦음)
 * - 하드 규칙: 딥링크 + 공정위 필수 문구는 결정론적 조립
 */

export const LEGAL_DISCLAIMER =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

const LeadResultSchema = z.object({
  lead: z.string().min(4).max(80),
});

export interface ReplyComposeInput {
  body: string;              // 본문 (컨텍스트로 사용)
  productName: string;
  productCategory?: string;
  deeplinkUrl: string;
  accountId: string;         // 페르소나 다변화 seed
  personaPrompt?: string;
}

export interface ReplyComposeResult {
  text: string;
  lead: string;
}

const SYSTEM_PROMPT = `너는 한국 Threads 고정 댓글의 첫 리드 문장을 만드는 도구다.
게시글 본문 아래 자기 댓글로 즉시 다는 짧은 멘트.

핵심 원칙:
- 광고 카피 아님. 친구가 무심코 툭 던진 감초 같은 한 마디.
- 상품·본문 맥락에 가볍게 연결되지만 상품 자랑 아님.
- 1문장, 최대 2줄, 대략 15~50자.
- 이모지는 안 쓰거나 최대 1개.

문체:
- 한국어 반말 + 인터넷 구어체
- 어미: ~임 / ~네 / ~ㄹ 뻔 / ~였음 / ~인 거 실화? / ~이라니
- 지나친 감성, 시적 은유 금지

금지:
- 브랜드명·모델명·가격·구매처·"쿠팡"·"파트너스"·"링크" 노골적 언급 금지
- 강추·추천·가성비·필수템·후기·리뷰 같은 홍보 냄새 어휘 금지
- 명령형·요청형 ("사세요", "확인해봐요") 금지
- **상품명 뒤에 붙는 부가·판촉 정보 절대 언급 금지**:
  · 사은품·증정 (양말 증정, 사은품, 무료 사은품)
  · 프로모션 (1+1, 2+1, 세트, 다양한 색상, 남녀공용, 정품, 특가)
  · 배송·수령 (무료배송, 로켓배송, 당일배송)
  · 모델 번호·품번 (1201A019 같은 코드)
  → 오직 상품의 **본질적 기능·경험·감각·문제해결** 만 다룸
  → "양말까지 껴주는데" 같이 사은품을 억지로 넣는 카피는 절대 X

자연 어투 강제:
- **실제 한국인이 SNS에 쓰는 표현만.** 요즘 Threads 유행어 OK (실화냐·미쳤음·진심).
- LLM 창작 은유·억지 비유 절대 금지 (예: "발바닥이 안 울어", "잠이 마중 옴").
- 축약 어미 (~됨/~옴/~함) 사용 시 목적어·주어 명확: 나쁨 "좀 됨" / 좋음 "발이 좀 편해짐".
- **처음 본 사람도 즉시 이해 가능해야.** 해석·추론 필요한 문장 X.

권장 스타일 예:
- "책상 위에 하나 놓았을 뿐인데 은근 별세계임"
- "이거 없이 어떻게 살았는지 모르겠음"
- "무심코 산 건데 요즘 제일 잘한 일임"
- "이거 하나로 아침 준비 시간 반 줄었음"
- "생각 없이 켰다가 이제 매일 씀"

JSON으로만 반환. 다른 텍스트 절대 금지.
{ "lead": "여기에 한 문장" }`;

export async function composeReply(input: ReplyComposeInput): Promise<ReplyComposeResult> {
  const persona = input.personaPrompt
    ? `\n\n== 계정 페르소나 (seed=${input.accountId}) ==\n${input.personaPrompt}`
    : '';
  const system = SYSTEM_PROMPT + persona;

  const userPrompt = [
    `상품: ${input.productName}${input.productCategory ? ` (${input.productCategory})` : ''}`,
    '',
    '본문 (연결 참고):',
    `"""${input.body}"""`,
    '',
    '위 본문 톤과 자연스럽게 이어지는 리드 한 문장을 JSON으로만 반환.',
  ].join('\n');

  const response = await llm().complete({
    tier: 'main',
    system,
    userParts: [{ type: 'text', text: userPrompt }],
    maxOutputTokens: 200,
    temperature: 0.85,
    jsonMode: true,
    jsonSchema: {
      type: 'object',
      properties: { lead: { type: 'string' } },
      required: ['lead'],
    },
  });

  const parsed = extractJson(response.text);
  const { lead } = LeadResultSchema.parse(parsed);

  // [광고] prefix 는 공정위·플랫폼 안전 표기용 — 링크 바로 옆에 반드시 존재해야 함
  const labeledLead = lead.startsWith('[광고]') ? lead : `[광고] ${lead}`;
  // Threads 자동 링크 미리보기 카드 방지: URL 앞에 zero-width space 삽입.
  // 브라우저는 여전히 클릭 가능한 URL로 인식하지만 Threads의 URL 감지·OG fetch는 회피.
  const maskedUrl = `​${input.deeplinkUrl}`;
  const text = [labeledLead, maskedUrl, '', LEGAL_DISCLAIMER].join('\n');
  logger.debug({ lead, textLength: text.length }, 'composeReply');
  return { text, lead };
}

function extractJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const s = stripped.indexOf('{');
    const e = stripped.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error(`no JSON in response: ${stripped.slice(0, 200)}`);
    return JSON.parse(stripped.slice(s, e + 1));
  }
}
