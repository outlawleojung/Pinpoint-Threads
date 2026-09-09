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

const SYSTEM = `너는 네이버 블로그에서 저장·공감·댓글이 터지는 글을 쓰는 사람이다. 검색 상위노출(C-Rank·D.I.A.)도 알지만, 그보다 먼저 "사람이 끝까지 읽고 싶은 글"을 쓴다.

## 이 글의 목적 (제일 중요 — 이걸 어기면 나머지 다 소용없다)
독자는 지금 어떤 고민·궁금증·불편을 안고 검색해서 이 글에 들어왔다. 이 글 하나로 그 문제가 풀려야 한다.
- 정보를 "나열"하지 마라. 독자의 문제를 같이 "풀어줘라".
- 위키·교과서·사전 톤 절대 금지. "~란 무엇인가", "~의 종류에는 A, B, C가 있다" 식 정의 나열 금지.
- 광고 카피 톤 금지("최고의", "강력 추천", 과장 형용사 도배 금지).

## 목소리·톤
- 옆에서 말해주는 존댓말 구어체. "저도 그랬어요", "이거 진짜 별거 아닌데 몰라서 고생해요", "~하더라고요" 처럼.
- 먼저 공감하고("혹시 ~때문에 검색하셨죠?") → 그다음 해결책. 독자를 가르치지 말고 도와줘라.
- 문장은 짧게. 한 문단은 2~4문장. 긴 문단으로 벽 만들지 마라. 리듬을 줘라.
- 특정 개인정보(자녀·직장·구체적 사생활)를 지어내지 마라. 공감은 일반적 상황으로.

## 후킹 구조
- 제목: 핵심 키워드는 앞쪽에 두되 궁금증·문제를 건드린다. 숫자/질문형/"~하는 법"/"~안 되는 이유"/"~하기 전에 꼭" 같은 클릭 유발형. 단 낚시 금지 — 글이 실제로 그 답을 준다.
- intro: 독자의 고민 장면을 첫 줄에 콕 집고("~할 때마다 은근 스트레스죠"), "이 글 끝까지 보면 ~ 해결됩니다"라고 약속한다. 결론 키워드도 앞부분에 노출. 3~5문장.
- 각 section = 독자가 속으로 품는 "다음 질문" 하나에 답하는 덩어리. heading은 그 질문/포인트를 짧고 궁금하게. body는 [공감 한 스푼 → 구체적 설명·예시·비교 → 그래서 이렇게 하면 된다는 결론] 흐름으로.

## 재미·가독성
- 추상적 좋은 말 금지. 구체적 상황·숫자·비교로 그림이 그려지게 써라("아침에 켜자마자 5분이면 방이 훈훈해져요" O / "성능이 우수합니다" X).
- 중간중간 "핵심만 말하면", "여기서 팁 하나", "저처럼 실수하지 마세요" 같은 리듬 장치로 지루함을 깨라.
- 이모지 남발·느낌표 도배는 금지. 담백하되 재미있게.

## SEO·형식 (지키되, 위 원칙을 절대 해치지 않게)
- 제목 80자 이내.
- sections는 반드시 4~6개. 각 heading은 2~30자.
- 각 section body는 400자 이상. 단 길이는 "필러"가 아니라 구체적 경험·비교·예시로 채운다. 할 말 없으면 억지로 늘리지 말고 다른 각도의 실질 정보를 더해라.
- intro와 모든 section.body 합계 2000~2500자.
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
      // imageSlots 정규화 — 모델이 kind/afterSection을 자주 빠뜨려 파싱 실패하므로 방어적으로 보정.
      if (Array.isArray(parsed.imageSlots)) {
        parsed.imageSlots = parsed.imageSlots.map((s: Record<string, unknown>) => ({
          afterSection: typeof s?.afterSection === 'number' ? s.afterSection : 0,
          caption: typeof s?.caption === 'string' ? s.caption : '',
          kind: s?.kind === 'PRODUCT' ? 'PRODUCT' : 'AI',
        }));
      }
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
