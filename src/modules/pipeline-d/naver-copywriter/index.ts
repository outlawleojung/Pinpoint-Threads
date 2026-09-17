import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import {
  NaverPostDraftSchema,
  NAVER_LEGAL_DISCLAIMER,
  NAVER_CATEGORIES,
  normalizeNaverCategory,
  type NaverPostDraft,
} from './schema.js';

export interface NaverCopywriteInput {
  topic: string;
  product: { name: string; price?: number; category?: string; specs?: string };
  connectUrl: string;
  kind: 'INFO' | 'AFFILIATE';
  extraNote?: string;
  /** INFO처럼 카테고리가 이미 정해진 경우 그대로 강제. 없으면 모델이 고른 뒤 정규화. */
  category?: string;
  /** 웹 리서치로 확보한 검증된 근거 자료(불릿). 있으면 본문은 이 사실에 기반해 작성. */
  sourceNotes?: string;
}

const SYSTEM = `너는 네이버 블로그 정보글을 쓴다. 목표는 딱 둘: (1) 검색해서 들어온 사람의 문제를 실제로 해결하는 유용한 정보, (2) 검색 상위노출(C-Rank·D.I.A.)이 잘 되는 구조. 사람인 척 꾸미지 말고, 정보를 깔끔하고 명확하게 전달해 신뢰를 얻어라.

## 이 글의 목적 (제일 중요 — 이걸 어기면 나머지 다 소용없다)
독자는 지금 어떤 고민·궁금증·불편을 안고 검색해서 이 글에 들어왔다. 이 글 하나로 그 문제가 풀려야 한다.
- 정보를 "나열"하지 마라. 독자의 문제를 같이 "풀어줘라".
- 위키·교과서·사전 톤 절대 금지. "~란 무엇인가", "~의 종류에는 A, B, C가 있다" 식 정의 나열 금지.
- 광고 카피 톤 금지("최고의", "강력 추천", 과장 형용사 도배 금지).

## 목소리·톤 (제일 중요)
- 깔끔하고 명확한 존댓말. 친절하되 담백하게. 독자를 가르치지 말고 도와줘라.
- ⚠️ 지어낸 개인 경험 절대 금지. "저는 작년에 ~했어요", "저도 ~해봤는데", "저처럼 실수하지 마세요" 류의 가짜 1인칭 경험담은 쓰지 마라 — 겪지도 않은 걸 지어내면 티가 나서 오히려 가짜 같고 신뢰가 깨진다. 경험담 없이 정보 자체로 승부해라.
- 문장은 짧게. 한 문단 2~4문장. 벽처럼 긴 문단 금지.
- 광고 카피 톤·과장 형용사 금지.

## 알짜 (이게 없으면 그냥 AI글이다 — 최우선)
독자가 이 글을 왜 읽어야 하는지 = "검색 1페이지엔 없는 알맹이"가 있어야 한다.
- 구체: 실제 수치·기준·재질/부품명·용어를 정확히. "튼튼해요/좋아요" 같은 뭉뚱그림 금지 → 왜/기준/숫자로.
- 메커니즘: "왜 그런지" 원리를 짧게 짚어라(그래야 독자가 응용함).
- 결정 규칙: "이럴 땐 A, 저럴 땐 B"로 바로 써먹게.
- 착각 교정: 사람들이 잘못 아는 지점을 콕 집어 바로잡기.
- 각 소제목엔 "검색해서 안 나오는" 한 방이 최소 하나. 다 아는 원론("용도를 정하세요")만 있으면 실패.
- ⚠️ 단, 과도하게 학술적/전문용어 나열 금지. 생활 독자가 바로 써먹을 실용 수준으로(논문 아님).

## 검색 노출 구조 (SEO — 핵심)
- 제목: 사람들이 실제로 검색하는 핵심 키워드를 앞쪽에 그대로 넣어라(검색 매칭이 1순위). 그 위에 숫자나 구체 포인트를 얹어 클릭을 유도. 낚시 금지 — 글이 실제로 답을 준다.
- intro: 첫 두세 문장 안에 핵심 키워드 + 이 글이 주는 답을 명확히. 고민 장면 묘사·"끝까지 보면 해결됩니다" 같은 상투구 없이, 바로 결론과 핵심을 던져라(체류·이탈 방지).
- 각 section = 독자가 품는 "다음 질문" 하나에 답하는 덩어리. heading은 그 질문/포인트를 짧고 구체적으로. body는 [핵심 답 → 근거·수치·비교 → 그래서 이렇게] 흐름.

## 재미·가독성
- 추상적 좋은 말 금지. 구체적 상황·숫자·비교로 그림이 그려지게 써라("아침에 켜자마자 5분이면 방이 훈훈해져요" O / "성능이 우수합니다" X).
- 중간중간 "핵심만 말하면", "여기서 팁 하나", "저처럼 실수하지 마세요" 같은 리듬 장치로 지루함을 깨라.
- 이모지 남발·느낌표 도배는 금지. 담백하되 재미있게.

## SEO·형식 (지키되, 위 원칙을 절대 해치지 않게)
- 제목 80자 이내.
- sections는 반드시 4~6개. 각 heading은 2~30자.
- 각 section의 productHint: 그 소제목을 읽은 독자가 자연스럽게 "이런 거 하나 있으면 좋겠다" 싶을 상품을 딱 집어 한 줄로(구체적 상품 유형 + 고를 때 포인트). 예: "신발장용 제습·탈취제(숯/실리카겔 타입)", "저소음 미니 가습기(책상용 소형)". 상품이 안 어울리는 소제목(개념 설명·계획 등)은 productHint를 빈 문자열로. 억지로 끼워넣지 말 것. 특정 브랜드·모델명은 쓰지 말고 상품 "유형"으로.
- 각 section body는 400자 이상. 단 길이는 "필러"가 아니라 구체적 경험·비교·예시로 채운다. 할 말 없으면 억지로 늘리지 말고 다른 각도의 실질 정보를 더해라.
- intro와 모든 section.body 합계 2000~2500자.
- imageSlots: 최소 3개 이상, section 개수만큼 배치(각 section 뒤 최소 1개). 상품 실물이 필요한 곳은 kind="PRODUCT", 보조 그래픽/썸네일은 kind="AI".
  각 imageSlots[].caption은 촬영자가 그대로 보고 찍을 수 있도록 "피사체 + 배경/장소 + 각도·분위기"를 담은 구체적인 한 문장으로 작성한다(1~2단어 라벨 금지).
  caption 예: "밝은 자연광 아래 흰 원목 책상 위 미니 가습기를 위에서 비스듬히 찍은 사진" (❌ "가습기").
- tags 5~10개(연관검색어·롱테일).
- disclaimer 필드에는 반드시 주어진 문구를 그대로 넣어라(어차피 서버가 덮어쓰지만 그대로 채워라).
- category: 이 글이 들어갈 블로그 카테고리를 아래 5개 중 정확히 하나로 고른다(문자열 그대로).
  ${NAVER_CATEGORIES.map((c) => `"${c}"`).join(' / ')}
- 출력은 아래 JSON 스키마 형태의 순수 JSON 하나만. 마크다운 코드펜스나 다른 텍스트 절대 금지.
{
  "title": "string (4~80자)",
  "intro": "string (40자 이상)",
  "sections": [ { "heading": "string (2~30자)", "body": "string (400자 이상)", "productHint": "이 소제목에 어울리는 상품 유형 한 줄(없으면 \\"\\")" } ],
  "imageSlots": [ { "afterSection": 0, "caption": "string", "kind": "PRODUCT" | "AI" } ],
  "tags": ["string", "..."],
  "disclaimer": "string",
  "category": "위 5개 중 하나"
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
${input.sourceNotes ? `\n[검증된 근거 자료 — 본문의 구체 사실은 반드시 이 자료에 기반하라. 자료에 없는 구체 수치·연도·고유명·규격은 지어내지 마라. 자료가 다루지 않은 부분은 일반적 표현으로.]\n${input.sourceNotes}\n` : ''}
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
      // 카테고리 강제 정규화 — INFO처럼 지정값이 있으면 그대로, 없으면 모델 출력을 5개 중 하나로 매핑.
      parsed.category = normalizeNaverCategory(input.category ?? parsed.category ?? input.topic);
      // imageSlots 정규화 — 모델이 kind/afterSection을 자주 빠뜨려 파싱 실패하므로 방어적으로 보정.
      if (Array.isArray(parsed.imageSlots)) {
        parsed.imageSlots = parsed.imageSlots.map((s: Record<string, unknown>) => ({
          afterSection: typeof s?.afterSection === 'number' ? s.afterSection : 0,
          caption: typeof s?.caption === 'string' ? s.caption : '',
          kind: s?.kind === 'PRODUCT' ? 'PRODUCT' : 'AI',
        }));
      }
      const draft = NaverPostDraftSchema.parse(parsed);
      logger.info({ title: draft.title, sections: draft.sections.length }, 'naver draft generated');
      // 2패스: 자기비평 + 깊이보정 + 사실완화로 본문 재작성(실패 시 초안 유지).
      const refined = await refineDraft(draft);
      return refined;
    } catch (err) {
      lastErr = err;
      logger.warn({ attempt, err }, 'naver draft parse 실패, 재시도');
    }
  }
  throw lastErr;
}

const REFINE_SYSTEM = `너는 깐깐한 블로그 편집장이다. 아래 JSON 초안의 intro와 각 section.body를 더 "알짜"로 다시 써서 같은 JSON으로 반환하라.
고칠 것:
1) 검색하면 다 나오는 뻔한 문장·원론 → 구체적이고 남다른 정보(수치·기준·메커니즘·결정 규칙·착각 교정)로 교체. 못 채우면 그 문장 삭제.
2) 근거 없는 뭉뚱그림("좋아요/튼튼해요") → 왜·기준·숫자로.
3) 헤지("~수도 있어요")·가짜 1인칭 상투구("저도 그랬어요/저처럼 실수하지") 제거, 단정적·실질적으로.
4) 과도한 학술·전문용어 나열은 오히려 줄여라 — 생활 독자가 바로 써먹을 실용 수준.
5) 불확실한 사실(수치·연도·고유명)은 단정하지 말고 일반 표현으로 낮추거나 삭제(틀린 정보 방지).
형식: {"intro":"...","sections":[{"heading":"...","body":"..."}]} 만. section 개수·순서는 초안과 동일하게. 각 body는 300자 이상. 다른 텍스트 금지.`;

/** 초안의 intro·sections를 비평·완화 패스로 재작성. 구조/기타 필드는 유지. 실패 시 초안 그대로. */
async function refineDraft(draft: NaverPostDraft): Promise<NaverPostDraft> {
  try {
    const payload = JSON.stringify({
      intro: draft.intro,
      sections: draft.sections.map((s) => ({ heading: s.heading, body: s.body })),
    });
    const res = await llm().complete({
      tier: 'main', system: REFINE_SYSTEM, jsonMode: true, temperature: 0.6, maxOutputTokens: 8192, thinking: 'disabled',
      userParts: [{ type: 'text', text: payload }],
    });
    const parsed = extractJson(res.text) as { intro?: string; sections?: Array<{ heading?: string; body?: string }> };
    if (!parsed?.intro || !Array.isArray(parsed.sections) || parsed.sections.length !== draft.sections.length) {
      logger.warn('refine 결과 형식 불일치 — 초안 유지');
      return draft;
    }
    const nextSections = draft.sections.map((s, i) => {
      const r = parsed.sections![i];
      const body = typeof r?.body === 'string' && r.body.trim().length >= 100 ? r.body.trim() : s.body;
      const heading = typeof r?.heading === 'string' && r.heading.trim() ? r.heading.trim().slice(0, 30) : s.heading;
      return { ...s, heading, body };
    });
    const refined: NaverPostDraft = { ...draft, intro: parsed.intro.trim() || draft.intro, sections: nextSections };
    logger.info({ title: refined.title }, 'naver post refined (2패스)');
    return refined;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'refine 실패 — 초안 유지');
    return draft;
  }
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
