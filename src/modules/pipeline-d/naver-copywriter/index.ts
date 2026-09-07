import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { NaverPostDraftSchema, NAVER_LEGAL_DISCLAIMER, type NaverPostDraft } from './schema.js';

export interface NaverCopywriteInput {
  topic: string;
  product: { name: string; price?: number; category?: string; specs?: string };
  connectUrl: string;
  kind: 'INFO' | 'AFFILIATE';
  extraNote?: string;
}

const SYSTEM = `너는 네이버 블로그 상위노출(C-Rank·D.I.A.)을 아는 한국어 블로그 작가다.
규칙:
- 제목 80자 이내, 핵심 키워드 맨 앞, 숫자/질문형 활용.
- intro(첫 문단)는 결론·핵심 키워드를 먼저 던진다(스크롤·체류 유도). 최소 40자 이상, 3~5문장으로 충분히 서술.
- sections는 반드시 4~6개. 각 heading은 2~30자의 짧은 소제목.
- 각 section의 body는 반드시 400자 이상(공백 포함)으로 길게 작성한다. 실사용·비교·후기형 구체 정보 위주(광고 카피 톤 금지, D.I.A. 대응).
  얕은 한두 문장으로 끝내지 말고, 구체적 상황·비교·근거를 덧붙여 충분히 서술할 것.
- intro와 모든 section.body를 합친 전체 본문 글자수가 2000~2500자가 되도록 분량을 맞춰라(부족하면 각 section body를 더 길게).
- imageSlots: 최소 3개 이상, section 개수만큼 배치(각 section 뒤 최소 1개). 상품 실물이 필요한 곳은 kind="PRODUCT", 보조 그래픽/썸네일은 kind="AI".
  각 imageSlots[].caption은 촬영자가 그대로 보고 찍을 수 있도록 "피사체 + 배경/장소 + 각도·분위기"를 담은 구체적인 한 문장으로 작성한다(1~2단어 라벨 금지).
  caption 예: "밝은 자연광 아래 흰 원목 책상 위 미니 가습기를 위에서 비스듬히 찍은 사진" (❌ "가습기").
- tags 5~10개(연관검색어·롱테일).
- disclaimer 필드에는 반드시 주어진 문구를 그대로 넣어라(어차피 서버가 덮어쓰지만 그대로 채워라).
- 출력은 아래 JSON 스키마 형태의 순수 JSON 하나만. 마크다운 코드펜스나 다른 텍스트 절대 금지.
{
  "title": "string (4~80자)",
  "intro": "string (40자 이상)",
  "sections": [ { "heading": "string (2~30자)", "body": "string (400자 이상)" } ],
  "imageSlots": [ { "afterSection": 0, "caption": "string", "kind": "PRODUCT" | "AI" } ],
  "tags": ["string", "..."],
  "disclaimer": "string"
}`;

export async function generateNaverPost(input: NaverCopywriteInput): Promise<NaverPostDraft> {
  const affiliateLine = input.kind === 'AFFILIATE'
    ? `이 글은 제휴(쇼핑커넥트) 글이다. 본문 중 자연스러운 위치에 상품을 소개하되, 첫 상품 언급 전 disclaimer가 오도록 intro 끝 또는 첫 section에 배치를 전제한다. 커넥트 링크: ${input.connectUrl}`
    : `이 글은 순수 정보성 글이다. 특정 상품 판매 목적이 아니라 주제 정보를 제공한다.`;

  const user = `주제(블로그 단일 주제): ${input.topic}
상품: ${input.product.name}${input.product.price ? ` / ${input.product.price}원` : ''}${input.product.category ? ` / ${input.product.category}` : ''}
스펙: ${input.product.specs ?? '(없음)'}
${affiliateLine}
${input.extraNote ? `추가 지시: ${input.extraNote}` : ''}

disclaimer 문구(그대로 사용): "${NAVER_LEGAL_DISCLAIMER}"

반드시 지켜라: sections는 4~6개, 각 section.body는 400자 이상, 전체(intro+모든 body) 합계 2000~2500자.`;

  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const nudge = attempt > 1
      ? '\n\n반드시 imageSlots의 각 항목에 kind(PRODUCT|AI)를 포함하라. 스키마의 모든 필수 필드를 빠짐없이 채워라.'
      : '';
    const userParts: LlmContentPart[] = [{ type: 'text', text: user + nudge }];

    try {
      const result = await llm().complete({
        tier: 'main',
        system: SYSTEM,
        userParts,
        jsonMode: true,
        temperature: 0.8,
        maxOutputTokens: 8192,
        thinking: 'disabled',
      });

      const parsed = extractJson(result.text);
      // disclaimer 강제 주입(모델이 변형해도 상수로 덮어씀)
      parsed.disclaimer = NAVER_LEGAL_DISCLAIMER;
      const draft = NaverPostDraftSchema.parse(parsed);
      logger.info({ title: draft.title, sections: draft.sections.length }, 'naver post generated');
      return draft;
    } catch (err) {
      lastErr = err;
      logger.warn({ attempt, err }, 'naver draft parse 실패, 재시도');
    }
  }
  throw lastErr;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`JSON 파싱 실패: ${text.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}
