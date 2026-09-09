import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { factCheckCopy } from '../../shared/copywriter/index.js';
import { renderSourceBrief, type SourceBrief } from '../../shared/copywriter/source-brief.js';

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

// 채널별 공정위 대가성 문구. 세 채널 모두 수수료 받는 제휴 링크 → 대가성 명시 필수.
function disclaimerFor(channel?: 'COUPANG' | 'MUSINSA' | 'NAVER'): string {
  if (channel === 'MUSINSA') {
    return '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
  }
  if (channel === 'NAVER') {
    return '이 포스팅은 네이버 쇼핑 제휴 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
  }
  return LEGAL_DISCLAIMER; // COUPANG 기본
}

/** 연결 멘트 풀 — 상품 확인(좌표)으로 잇는 리드. 계정 시드로 회전(같은 멘트 연속 방지). */
export const REPLY_CONNECTORS = [
  '문의 많아서 좌표 남겨둠',
  '궁금한 사람 있을까봐 여기 둠',
  '정보 물어보는 분들 많아서 댓글에',
  '혹시 몰라 좌표 남겨놓음',
  '어디서 사냐는 댓글 많아서',
];
export function pickConnector(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return REPLY_CONNECTORS[h % REPLY_CONNECTORS.length]!;
}

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
  channel?: 'COUPANG' | 'MUSINSA' | 'NAVER';
  sourceBrief?: SourceBrief;
  sourceText?: string;
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
- **본문을 되풀이하지 마라.** 본문에서 이미 한 말·감탄을 반복하면 안 됨 — 새 각도로 상품 확인을 연결한다.
- **상품 확인으로 자연스럽게 연결.** "좌표 남겨둠", "궁금한 사람 있을까봐" 처럼 어디서 보는지로 잇는 명분 한 줄.
- **없는 효능·인기·품절을 덧붙이지 마라.** "다들 산다 / 품절대란 / 효과 검증" 금지.
- 원본 보존 기준이 있으면 본문과 같은 포인트를 유지. 원본에 없는 체험·효능·지속시간·비교를 추가하지 않는다.
- 본문에서 만든 관심을 연결 상품으로 자연스럽게 이어준다. 새 감탄이나 상품 장점 설명을 억지로 추가하지 않는다.
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
- **개인정보·가족·직업 노출 절대 금지**:
  · 자녀·아이·아기·학부모·상담·육아·유치원·학교 관련 언급 X
  · 직업·근무·야근·나이트·교대·회의·팀장 관련 언급 X
  · 결혼·남편·아내·시댁·친정 언급 X
  · 나이·연령대 (30대·40대·워킹맘 등) 언급 X
  → 페르소나가 그런 배경이라도 카피에는 절대 노출 X
  → 오직 상품 자체와 상품 사용 경험만 다룸
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
- 본문·미디어와 함께 바로 이해되면 주어·목적어·결론 생략 가능. 억지 비유는 금지.

원작자의 체험을 게시 계정의 체험으로 쓰지 않는다.
"직접 써봤는데", "아침 준비 시간 반 줄었음", "향수보다 오래감" 같은 근거 없는 체험·효능은 금지.
사진/영상 속 제품과 연결 상품이 동일하다는 확인이 없으면 동일 제품이라고 단정하지 않는다.

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
    `이번 연결 톤 참고 (그대로 복붙 X · 톤·각도만): "${pickConnector(input.accountId)}"`,
    input.sourceBrief ? renderSourceBrief(input.sourceBrief) : '',
    input.sourceText ? `원문 자료: ${JSON.stringify(input.sourceText)}` : '',
  ].join('\n');

  let lead = '';
  let avoid = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await llm().complete({
      tier: 'fast',
      system,
      userParts: [{ type: 'text', text: userPrompt + (avoid ? `\n이전 오류 수정: ${avoid}` : '') }],
      maxOutputTokens: 200,
      temperature: 0.85,
      jsonMode: true,
      thinking: 'disabled',
      jsonSchema: {
        type: 'object',
        properties: { lead: { type: 'string' } },
        required: ['lead'],
      },
    });

    const parsed = extractJson(response.text);
    lead = LeadResultSchema.parse(parsed).lead;
    if (!input.sourceBrief) break;
    const check = await factCheckCopy({
      body: `본문: ${input.body}\n댓글 리드: ${lead}`,
      productName: input.productName, productCategory: input.productCategory,
      sourceBrief: input.sourceBrief, sourceText: input.sourceText,
    });
    if (check.ok) break;
    if (attempt === 1) throw new Error(`댓글 원본 보존 검사 실패: ${check.reason}`);
    avoid = check.reason ?? '원본에 없는 주장을 제거한다';
  }

  // [광고] prefix 는 공정위·플랫폼 안전 표기용 — 링크 바로 옆에 반드시 존재해야 함
  const labeledLead = lead.startsWith('[광고]') ? lead : `[광고] ${lead}`;
  // Threads 자동 링크 미리보기 카드 방지: URL 앞에 zero-width space 삽입.
  // 브라우저는 여전히 클릭 가능한 URL로 인식하지만 Threads의 URL 감지·OG fetch는 회피.
  const maskedUrl = `​${input.deeplinkUrl}`;
  const text = [labeledLead, maskedUrl, '', disclaimerFor(input.channel)].join('\n');
  logger.debug({ lead, textLength: text.length }, 'composeReply');
  return { text, lead };
}

/**
 * Line B 미니 큐레이션 고정 댓글 (상품 2~3개).
 * 기존 단일 상품 형식과 동일 규칙: [광고] 리드 + zero-width space 마스킹 링크 + 공정위 문구.
 * 리드는 대표 상품·테마 맥락으로 AI 감초 한 문장 생성 (composeReply 와 동일 프롬프트).
 */
export interface CurationReplyInput {
  body: string;
  categoryKr: string;
  items: Array<{ name: string; deeplinkUrl: string }>; // 2~3개
  accountId: string;
  personaPrompt?: string;
  channel?: 'COUPANG' | 'MUSINSA' | 'NAVER';
}

export async function composeCurationReply(input: CurationReplyInput): Promise<ReplyComposeResult> {
  const persona = input.personaPrompt
    ? `\n\n== 계정 페르소나 (seed=${input.accountId}) ==\n${input.personaPrompt}`
    : '';
  const system = SYSTEM_PROMPT + persona;

  const userPrompt = [
    `테마: ${input.categoryKr} (요즘 찾아본 상품 ${input.items.length}개 묶음)`,
    '',
    '본문 (연결 참고):',
    `"""${input.body}"""`,
    '',
    '위 본문 톤과 자연스럽게 이어지는 리드 한 문장을 JSON으로만 반환. (개별 상품 언급 X · 묶음 전체를 가볍게)',
  ].join('\n');

  let lead = '요즘 찾아본 것들 여기 둠';
  try {
    const response = await llm().complete({
      tier: 'fast',
      system,
      userParts: [{ type: 'text', text: userPrompt }],
      maxOutputTokens: 200,
      temperature: 0.85,
      jsonMode: true,
      jsonSchema: { type: 'object', properties: { lead: { type: 'string' } }, required: ['lead'] },
    });
    lead = LeadResultSchema.parse(extractJson(response.text)).lead;
  } catch (err) {
    logger.warn({ err }, 'composeCurationReply lead 생성 실패 · 기본 리드 사용');
  }

  const labeledLead = lead.startsWith('[광고]') ? lead : `[광고] ${lead}`;
  // 각 링크 앞 zero-width space (Threads 링크 프리뷰 카드 억제)
  const linkLines = input.items.slice(0, 3).map((it) => `​${it.deeplinkUrl}`);
  const text = [labeledLead, ...linkLines, '', disclaimerFor(input.channel)].join('\n');
  logger.debug({ lead, links: linkLines.length }, 'composeCurationReply');
  return { text, lead };
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
    const s = stripped.indexOf('{');
    const e = stripped.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error(`no JSON in response: ${stripped.slice(0, 200)}`);
    return JSON.parse(stripped.slice(s, e + 1));
  }
}
