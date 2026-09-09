import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { searchSimilar, type SimilarBenchmark } from '../source-collector/embedder.js';
import { isVoyageConfigured } from '../../../infra/voyage-client.js';
import { prisma } from '../../../db/prisma.js';
import { analyzeSource, renderSourceBrief, type SourceBrief } from './source-brief.js';
import { renderWinningStyle } from './winning-style.js';

/**
 * Copywriter — 원본을 참고해 계정별 페르소나로 완전 재창조하는 카피 노드.
 *
 * 원칙 (2026-08-31 재정의):
 * - 원본 소재·훅만 참고. 직역·복붙 금지. 소스 언어(ko/en/zh/ja) 무관.
 * - 원본의 구체적인 장면·상황에 붙는 짧은 반응 생성.
 * - 원본의 반응 포인트를 먼저 보존하고 페르소나는 어투를 조절.
 *   같은 원본이라도 계정별로 완전히 다른 카피가 나와야 함.
 * - 상품 정보(있으면) 반영, 단 광고 카피처럼 보이지 않게.
 */

export const LEGAL_DISCLAIMER =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

const BodyResultSchema = z.object({
  body: z.string().min(6).max(200),
});

export type CopywriteResult = {
  body: string;
  reply: string;
  sourceBrief: SourceBrief;
};

export interface CopywriteInput {
  sourceText?: string;
  sourceLanguage?: string | null;
  sourceImageUrl?: string;
  sourceMediaDescription?: string;
  productName?: string;
  productCategory?: string;
  personaPrompt?: string;
  accountSeed: string;
  deeplinkUrl?: string;
  channel?: 'COUPANG' | 'MUSINSA' | 'NAVER';
  variantCount?: number;
  ragEnabled?: boolean; // Voyage RAG로 유사 벤치마크 top-K few-shot
  ragTopK?: number;
  accountId?: string; // 리젝 사유 few-shot 조회용
  factCheckEnabled?: boolean; // Haiku 사실검증 스텝 (기본 true · shopping 필수)
  factCheckMaxRetries?: number; // 기본 2회
  regenAvoid?: string; // 재생성 시 이전 카피 회피 힌트 (텔레그램 "텍스트 재생성" 버튼)
}

/**
 * 페르소나가 없을 때 사용할 최소 기본값.
 * 실제 운영에서는 각 Account.personaPrompt를 반드시 전달해야 함.
 */
const NEUTRAL_PERSONA =
  '한국 Threads 사용자. 담백한 구어체. 특정 성별·연령대 지향 없음. 이모지 절제.';

/**
 * 플랫폼 규칙 (누구에게나 공통).
 * 페르소나 특유 톤·연령대·성별 언급 없음 — 그건 personaPrompt 담당.
 */
export const UNIVERSAL_PRINCIPLES = `너는 원본 콘텐츠를 보고 한국 사람이 그 장면을 보다가 툭 꺼낼 법한 Threads 게시글을 작성한다. 상품 소개보다 장면에 딱 맞는 반응을 우선한다.

작성 전 포인트 선택 (최종 출력에는 분석을 넣지 않음):
- 입력에서 실제로 확인되는 장면·상황 → 변화나 결과(있을 때만) → 반응할 포인트 하나를 짧게 정리한 뒤 작성한다.
- 색·형태·뜻밖의 모습·익숙한 불편·실수·사용 전후 변화·웃긴 모순 중 가장 즉각적으로 눈에 들어오는 것을 고른다. 억지로 반전이나 결과를 만들지 않는다.
- 원본의 높은 조회수만으로 성공 원인을 단정하지 않는다. 상품명에 적힌 기능보다 원본에서 실제로 확인되는 포인트가 우선이다.
- 영상 전체나 장면 설명이 입력에 없다면 보지 못한 동작·전개·결말을 상상하지 않는다. 원문과 제공된 이미지에서 확인되는 범위만 사용한다.

플랫폼 규칙:
- 기본 1~3줄, 대략 18~80자 (넘어가도 150자 이내). 문장 수를 억지로 맞추지 않는다.
- 제목/설명/해설/해시태그/부연 코멘트 절대 금지. 오로지 본문 문장만.
- 광고 카피처럼 보이면 안 됨. 친구가 툭 던진 느낌.
- **미디어가 장점을 보여주면 문구는 필요한 반응만 보탠다.** 왜 좋은지·근거·추천·결론을 반드시 붙이지 않는다.
  손에 보호대를 끼우고 칼질하는 장면:
    설명형: "손가락을 보호해 안전하고 편리하게 칼질할 수 있음"
    반응형: "칼질할 때 손부터 걱정되는 사람 나만 아니지"
  바닥이 유난히 두꺼운 컵 사진:
    설명형: "두꺼운 하단부 디자인과 투명한 소재가 고급스러움"
    반응형: "잔보다 바닥이 더 두꺼운 것 같은데 ㅋㅋ"
  예시 문구·구조를 다른 상품에 반복 적용하지 말고 이번 원본에서 포인트를 새로 고른다.
- **실제 한국인이 SNS에 흔히 쓰는 자연 어투만.**
  요즘 Threads 유행 말투·단어는 OK (예: "실화냐" "미쳤음" "진심" "레알" 스레드에서 흔함).
  하지만 LLM 창작 은유·억지 비유 절대 금지:
    나쁨: "발바닥이 안 울어" / "밑창이 노래함" / "발이 여행을 떠남" (실사용 X, 어색)
  미디어와 함께 즉시 이해된다면 주어·목적어·결론을 생략하거나 문장을 덜 닫아도 된다.
  판정 기준: **처음 본 사람도 미디어와 문구를 바로 연결할 수 있어야.** 배경지식이나 억지 해석이 필요한 비유는 X.
- ㅋㅋ·감탄사·말줄임표는 실제 웃김·놀람·여운이 있을 때만. 친근함을 꾸미려고 습관적으로 붙이지 않는다.
- **Threads는 반말이 기본이다.** 존댓말은 특정 페르소나가 명시적으로 요구할 때만.
  일반적으로 "~함/~더라/~인 듯/~됐다/~해봤는데" 반말 어미 사용.
  페르소나에 "존댓말" 지시가 없거나 "반말 기본" 이면 무조건 반말.
- **브랜드명·제품명 언급은 OK.** 스레드 실제 톤에도 브랜드가 자주 나온다.
  단, 그 자체가 카피의 목적이 되면 안 됨. "OO 사세요/OO 강추" 같은 판매 톤은 X.
  장면을 이해하는 데 필요할 때만 자연스럽게 언급한다. 브랜드 자체를 앞세우지 않는다.
- **1인칭 사용·목격·소장 톤 허용 (사용자 방침).** "써봤는데"·"신어보니"·"봤는데"·"소장각" 같이 게시자가 겪은 듯한 리액션을 써도 된다. 원본이 해외 글이어도 우리 계정의 반응처럼 표현 가능.
- **★ 단, 틀린 사실·지어낸 비교는 금지.** 감탄·욕구·1인칭 반응·"~일 듯" 추측은 자유지만, 아래는 하지 마라:
  · **상품을 엉뚱한 브랜드·다른 제품으로 지칭** (예: 버켄스탁을 "삼선 슬리퍼"=아디다스로 부르기). 상품명·원본에서 확인되는 브랜드·종류를 틀리게 말하지 마라.
  · **원본·상품정보에 없는 타제품과의 구체적 비교를 사실처럼 지어내기** (예: 원문에 없는데 "삼선 슬리퍼 이미지밖에 없었는데 이건 다르더라"). 없는 배경·비교를 꾸미지 마라.
  · **근거 없는 성능 우위·수치·효능** (예: "X보다 발이 덜 아픔", "키 5cm 커 보임").
  허용: 주관적 취향·분위기 비교("크록스 대신 이런 느낌으로 신고 싶음"), 눈에 보이는 것에 대한 반응·추측. 즉 "내 느낌"은 OK, "틀린 사실"은 NO.
- **정확한 가격 숫자·"○○% 할인"·"오늘까지"·"타임세일" 금지** (광고 티).
  → "15,900원" · "30% 세일" · "오늘 자정까지" 같은 표현 X.
- **상품 사용처·조리법·활용 방식·착용 상황 지어내지 X.**
  · 상품 종류에 맞는 표준 사용처·상황만 언급. 확신 없으면 언급 자체를 피해라.
  · 예: 열무김치 → 김치찌개 X (열무는 물김치/열무국수/비빔국수용). 배추김치일 때만 김치찌개.
  · 예: 스킨/토너 → 마시기 X. 마스크팩 → 굽기 X.
  · **의류·신발·잡화는 그 물건을 실제로 쓰는 상황으로만.** 안 맞는 활동에 끼워넣지 마라.
    - **페이크삭스·덧신·노쇼삭스 → 러닝·헬스·등산 등 운동 상황 X.** 이건 구두·단화·운동화에 "양말 안 보이게" 신는 데일리 아이템.
      쿠션 버전의 강점은 "하루 종일 걷거나 서 있을 때 발바닥 편함"·"구두 신어도 안 아픔" 이지 운동복이 아니다.
      나쁨: "러닝화 신고 뛰니까 발바닥 안 배김" · "운동 후에 또 신게 됨" (덧신으로 운동 안 함)
      좋음: "구두 신는 날 이거 신으면 발바닥이 안 아픔" · "종일 서서 일해도 발 안 배김"
    - 예: 정장 구두 → 등산 X · 슬리퍼 → 러닝 X · 얇은 여름 원피스 → 한겨울 X.
  · 상품과 조합할 요리·음식·상황이 애매하면 **일반적 반응만** 남기고 구체 활용·상황은 빼라.
- 가격·가성비 감탄을 억지로 추가하지 않는다. 입력에 가격 근거가 없으면 저렴함도 추정하지 않는다.
- **구매 링크·구매처("쿠팡/무신사/네이버")를 본문에 쓰지 않음.** 링크는 고정 댓글로만.
- 제품 스펙·성분·기능 나열 금지 (설명서 톤). 상황·행동·감정·발견 중심.

원본 처리 원칙 (매우 중요):
- 원본이 한국어가 아닐 수 있음 (영어·중국어·일본어 등). 언어 상관없이 처리.
- 원본은 **소재와 훅만** 참고. 문장 구조·표현을 그대로 옮기지 말 것.
- **★ 원문이 한국어여도(같은 제품의 한국 버전 등) 문장을 그대로 복사하지 마라.** 번역이 필요 없다고 베끼지 말고,
  표현·리듬만 참고해 위 목표 스타일(하입·훅)로 **새로 써라.** 여러 원문을 줄 때 그중 한 문장을 통째로 옮기면 실패다.
- 직역 금지. 원본이 말하는 상황·감정·발견을 잡아서 아래 페르소나 톤으로 완전히 새로 작성.
- 원본에 있는 감탄사·이모지·문화 코드를 그대로 옮기지 말 것 (예: "太绝了" → 한국식 감탄으로 치환).
- 원본이 강조하는 훅(놀람·발견·공감·질문 등)의 종류는 유지하되 표현은 완전히 재창조.
- 원본의 매력적인 상황과 반전은 보존한다. 한국식이라는 이유로 출근·회식 같은 새로운 상황을 억지로 넣지 않는다.
- 원본의 반응 포인트를 먼저 보존하고 페르소나는 어투만 조절한다. 페르소나에 맞추려고 원본에 없는 사건·체험을 만들지 않는다.

출력 전 품질 확인:
- 이 문구가 원본의 어느 장면·상황에 붙는 말인지 분명한가?
- 미디어가 이미 보여주는 기능을 불필요하게 설명하고 있지는 않은가?
- 다른 상품에 그대로 붙여도 통하는 막연한 감탄이면 원본의 구체적인 포인트를 다시 고른다.
- "왜 이제 알았지" 같은 정형 마무리를 반복하지 않는다. 상품 칭찬보다 발견·행동·감정이 자연스럽게 느껴지는가?

금지 어휘 (광고 냄새 100% · 강사 GPT 정본):
- 직접 구매유도: 지금 바로 구매, 사러가기, 구매 링크, 할인 중, 최저가, 선착순, 강추/강력 추천.
- 진부한 찬사·스펙: 최고의 제품, 완벽한, 압도적, 필수 아이템, 고성능, OO% 함유, 특허, 가성비/혜자.
- 설명조 종결어미: "~에 좋습니다 / ~해보세요 / ~을 자랑합니다 / ~에 효과적입니다" (상세페이지 말투 = 스크롤 넘김).
- **허용(오히려 권장): 미쳤네/미쳤나, 실화?, 사고 쳤네, 소름, 대박, 진심, 종결, 원탑 템, 갓템, 소장각/소장 욕구, 장난 아님, ㄷㄷ, 순삭.** 반응 강하면 절제 말고 그대로.

**개인정보·가족·직업 노출 절대 금지**:
- 자녀·아이·아기·학부모·육아·유치원·학교 관련 언급 X
- **특정 직업·직종 식별** (간호사·교사·나이트 근무·3교대·야간 근무·워킹맘 등) X
- 결혼·남편·아내·시댁·친정 언급 X
- 나이·연령대 (30대·40대 등) 명시 X
- **일반 사회 상황은 OK**: 회식·외식·출근·퇴근·모임·여행 등 누구나 겪는 상황은 허용.
- **페르소나에 그런 배경이 있어도 신상은 감춘다.** 톤만 반영 · 상품 경험 중심.

출력 포맷:
JSON으로만 반환. 다른 텍스트 금지.
{ "body": "여기에 본문 문장" }`;

function buildSystemPrompt(input: {
  personaPrompt?: string;
  accountSeed: string;
  variantIndex: number;
  sourceLanguage?: string | null;
  shopping?: boolean;
}): string {
  const persona = input.personaPrompt?.trim() || NEUTRAL_PERSONA;
  const langHint = input.sourceLanguage
    ? `\n\n원본 감지 언어: ${input.sourceLanguage} (직역 금지, 아래 페르소나로 재창조)`
    : '';

  return `${UNIVERSAL_PRINCIPLES}

== 이 계정의 페르소나 (seed=${input.accountSeed}, variant=${input.variantIndex}) ==
${persona}

원본의 장면·상황·반응 포인트를 먼저 보존한다. 페르소나는 그 포인트를 표현하는 어투·문체를 조절한다.
페르소나의 어투·이모지 규칙은 위 공통 원칙 안에서 적용한다. 없는 체험은 추가하지 않는다. ${input.shopping ? '과거 페르소나의 감탄사·브랜드·추천 일괄 금지나 담백함 지시가 쇼핑 지침과 충돌하면 쇼핑 지침을 우선한다. 계정의 말투는 유지하되 상품의 매력과 소장 욕구를 충분히 표현한다.' : '상품 장점 설명을 추가하지 않는다.'}${langHint}`;
}

async function generateBody(input: CopywriteInput & { sourceBrief: SourceBrief }, seedIndex: number, extraAvoid?: string): Promise<string> {
  const system = buildSystemPrompt({
    personaPrompt: input.personaPrompt,
    accountSeed: input.accountSeed,
    variantIndex: seedIndex,
    sourceLanguage: input.sourceLanguage ?? null,
    shopping: true,
  });

  const userParts: LlmContentPart[] = [];
  userParts.push({ type: 'text', text: renderSourceBrief(input.sourceBrief) });
  // 목표 스타일 주입 — 사용자 계정 실제 고반응 글에서 역설계한 하입/FOMO/무심한 툭툭 공식.
  userParts.push({ type: 'text', text: renderWinningStyle() });

  if (input.sourceImageUrl) {
    userParts.push({ type: 'image', url: input.sourceImageUrl });
  }

  if (input.sourceText) {
    const langLabel = input.sourceLanguage ? ` (${input.sourceLanguage})` : '';
    userParts.push({
      type: 'text',
      text: `참고 원문${langLabel} — 소재·훅 참고용, 직역 금지, 페르소나로 완전 재창조:\n"""\n${input.sourceText}\n"""`,
    });
  }

  // RAG: 유사 벤치마크 top-K를 few-shot 힌트로 (Voyage 있고 sourceText 있을 때만)
  if (input.ragEnabled && input.sourceText && isVoyageConfigured()) {
    try {
      const similar = await searchSimilar({
        queryText: input.sourceText,
        topK: input.ragTopK ?? 3,
        minLikes: 500,
        contentType: 'SHOPPING',
      });
      if (similar.length > 0) {
        userParts.push({
          type: 'text',
          text: renderBenchmarkHints(similar),
        });
      }
    } catch (err) {
      logger.warn({ err }, 'RAG lookup failed — proceeding without few-shot');
    }
  }

  // 과거 리젝 사유 few-shot (같은 계정 · 최근 20건) — 반복 실수 방지
  if (input.accountId) {
    const priorRejects = await loadRecentRejections(input.accountId, input.productCategory);
    if (priorRejects.length) {
      userParts.push({
        type: 'text',
        text:
          `⛔ 아래는 이 계정의 최근 리젝 사례다. 같은 실수·유사 실수 절대 반복 X:\n` +
          priorRejects.map((r, i) => `${i + 1}. 카피: "${r.body}"\n   사유: ${r.reason}`).join('\n'),
      });
    }
  }

  const contextLines: string[] = [];
  if (input.productName) {
    contextLines.push(`연결 상품명(종류 확인용. 원본과 일치가 확인된 브랜드·모델은 자연스럽게 언급 가능, 전체 상품명 복사 금지): ${input.productName}`);
    contextLines.push(
      `상품 정보는 종류·사용처를 잘못 쓰지 않도록 확인하는 참고 자료다.\n` +
      `원본에서 보이는 매력을 중심으로 한국 독자가 갖고 싶은 이유를 표현한다. 상품명만 보고 원본에 없는 기능이나 장점을 추가하지 않는다.`,
    );
  }
  if (input.productCategory) contextLines.push(`상품 카테고리: ${input.productCategory}`);
  if (extraAvoid) contextLines.push(`⛔ 방금 실패 사유 · 이번엔 반드시 회피: ${extraAvoid}`);
  contextLines.push('원본의 구체적 매력 → 한국 독자의 취향·소장·활용 관심으로 이어지는 쇼핑 카피를 작성. 자연스러운 비교와 감정은 살리고, 직역·범용 감탄·허구 주장은 점검한 뒤 가장 좋은 본문 1개만 { "body": "..." } JSON으로 반환.');
  userParts.push({ type: 'text', text: contextLines.join('\n') });

  if (userParts.length === 0) {
    throw new Error('Copywriter needs at least sourceImageUrl or sourceText');
  }

  const response = await llm().complete({
    tier: 'main',
    system,
    userParts,
    maxOutputTokens: 512,
    temperature: 0.9 + seedIndex * 0.05,
    jsonMode: true,
    thinking: 'disabled',
    jsonSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Threads 게시글 본문 문장, 6~200자' },
      },
      required: ['body'],
    },
  });

  const parsed = extractJson(response.text);
  const { body } = BodyResultSchema.parse(parsed);
  return body;
}

/**
 * 유사 벤치마크를 few-shot 힌트로 렌더 (Copywriter 시스템 프롬프트에 붙임).
 * 카피 자체는 유사 벤치마크의 톤을 참고할 뿐, 문장 그대로 옮기지 않음.
 */
function renderBenchmarkHints(items: SimilarBenchmark[]): string {
  const lines: string[] = [];
  lines.push('참고 — 유사 소재로 반응 좋았던 게시글 (톤·훅 패턴만 흡수, 문장 그대로 옮기지 말 것):');
  items.forEach((it, i) => {
    const factors = it.viralFactors as { hook_type?: string; tone?: string } | null;
    const meta = factors
      ? `[hook:${factors.hook_type ?? '?'} · tone:${factors.tone ?? '?'} · 👍${it.likesCount}]`
      : `[👍${it.likesCount}]`;
    lines.push(`\n${i + 1}. ${meta}\n"""\n${it.text.slice(0, 300)}\n"""`);
  });
  return lines.join('\n');
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
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`no JSON object in LLM response: ${stripped.slice(0, 200)}`);
    }
    return JSON.parse(stripped.slice(start, end + 1));
  }
}

export function buildReply(deeplinkUrl: string | undefined): string {
  if (!deeplinkUrl) {
    return LEGAL_DISCLAIMER;
  }
  return [
    '정보 물어보시는 분들 많아서 링크 남겨요 🙌',
    deeplinkUrl,
    '',
    LEGAL_DISCLAIMER,
  ].join('\n');
}

export async function generateCopy(input: CopywriteInput): Promise<CopywriteResult> {
  // 상품명/페르소나로 사건을 재창작하기 전에 원본을 고정. 본문 재시도는 같은 분석을 재사용.
  const sourceBrief = await analyzeSource(input, (request) => llm().complete(request));
  const groundedInput = { ...input, sourceBrief };
  const factCheck = input.factCheckEnabled ?? Boolean(input.productName); // 상품 있으면 기본 ON
  const maxRetries = input.factCheckMaxRetries ?? 1; // 비용 절감: 2→1 (최대 2회 생성)

  let body = await generateBody(groundedInput, 0, input.regenAvoid);
  let lastReason: string | undefined;

  if (factCheck) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const check = await factCheckCopy({
        body,
        productName: input.productName,
        productCategory: input.productCategory,
        sourceBrief,
        sourceText: input.sourceText,
      });
      if (check.ok) break;
      lastReason = check.reason;
      logger.warn(
        { attempt, body, reason: check.reason, productName: input.productName },
        'copy fact-check failed → regenerate',
      );
      if (attempt === maxRetries) {
        throw new Error(`Copywriter fact-check failed ${maxRetries + 1} times: ${check.reason}`);
      }
      body = await generateBody(groundedInput, attempt + 1, check.reason);
    }
  }

  const reply = buildReply(input.deeplinkUrl);
  const result: CopywriteResult = { body, reply, sourceBrief };
  logger.debug({ result, factCheck, lastReason }, 'generateCopy');
  return result;
}

/**
 * Haiku 사실검증: 카피에 상품 종류·사용처·성분 관련 명백한 오류가 있는지 판정.
 * 예: 열무김치 → 김치찌개 (X), 스킨케어 → 먹는다 (X), 여성 상품 → 남성 언급 (X).
 */
export async function factCheckCopy(args: {
  body: string;
  productName?: string;
  productCategory?: string;
  sourceBrief?: SourceBrief;
  sourceText?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  // productName 없어도 **개인정보·정책 검사**는 수행 (일상글 Pipeline C 페르소나 누출 방지).
  // 상품이 없으면 사실오류(§1)는 자연히 해당 없음, 개인정보(§2)만 판정.

  const system = `너는 한국 SNS 쇼핑 카피의 **사실·정책 검사기**다.

다음 중 하나라도 있으면 ok=false:

1) 사실 오류 (상품에 대해 명백히 틀린 표현):
- 상품 종류와 안 맞는 사용처 (예: 열무김치 → 김치찌개 · 열무는 물김치/열무국수용)
- 상품 종류와 안 맞는 조리·활용 방식 (예: 스킨을 마시기, 마스크팩을 굽기)
- **상품 종류와 안 맞는 착용/사용 상황·활동** (예: 페이크삭스·덧신·노쇼삭스를 러닝·헬스·등산 등 운동에 신는다 · 슬리퍼로 러닝 · 정장 구두로 등산 → 이런 물건은 그 활동에 안 씀)
- 상품 카테고리 오인 (예: 향수를 얼굴에 바르기)
- 성분·기능 근거 없이 지어낸 효능
- 상품이 아닌 것을 상품처럼 언급
- **상품을 틀린 브랜드·다른 제품으로 지칭** (예: 버켄스탁을 "삼선 슬리퍼"(아디다스)로 부름 · 브랜드/모델 혼동)
- **원본·상품정보에 없는 타제품과의 구체적 비교나 배경을 사실처럼 지어냄** (예: 원문에 없는데 "삼선 슬리퍼 이미지밖에 없었는데 이건 다름", 근거 없는 "X보다 성능 좋음")
  ★ **1인칭·개인 이력으로 감싸도 브랜드 오인은 FAIL.** 예: "버켄 삼선 슬리퍼만 신다가 이거 보니…" → 버켄스탁은 삼선(아디다스)이 아니므로 틀린 사실 = ok=false. "직접 신어보니 예쁨"(1인칭 반응, 브랜드 정확) = ok=true.
  ※ 허용(ok=true): 주관적 취향·분위기 비교("크록스 대신 이런 느낌")·"~일 듯" 추측·감탄·소장 욕구. 브랜드·제품 정체성만 틀리지 않으면 됨.

2) 개인정보·가족·직업 노출 (정책 위반):
- 자녀·아이·학부모·육아·유치원·학교 관련 언급
- **특정 직업·직종 식별** (간호사·교사·나이트 근무·3교대·워킹맘 등 · 직업을 특정하는 표현)
- 결혼·남편·아내·시댁·친정 언급
- 나이·연령대 (30대·40대 등) 명시
※ **일반 사회 상황은 허용**: 회식·외식·출근길·퇴근·모임·약속·여행 등 누구나 겪는 상황은 직업 노출 아님 → ok=true
  (예: "회식 끝나고 쓰니까 개운함" OK · "야간 근무 중에 썼다" X)

**판정 원칙**: 명백한 오류·정책 위반만 ok=false. 애매한 취향·과장·감정은 ok=true.
문학적 은유·감탄·구어체 흔한 표현은 오류 아님.
**1인칭 사용·목격·소장 톤은 허용한다** (사용자 방침): "신어보니 예쁨", "카페에서 봤는데", "직접 써보니 시원함" 같은
게시자 체험·반응은 조작으로 보지 않는다. §1 상품종류 오류와 §2 개인정보만 판정한다.

JSON으로만: { "ok": boolean, "reason": "짧게 어떤 오류인지 (ok=true면 빈 문자열)" }`;

  const user = `${args.productName ? `상품: ${args.productName}${args.productCategory ? ` (카테고리: ${args.productCategory})` : ''}` : '상품 없음 (일상글 · 개인정보·정책만 검사)'}
카피: "${args.body}"

판정 JSON:`;

  try {
    const res = await llm().complete({
      tier: args.sourceBrief ? 'main' : 'fast',
      system,
      userParts: [{ type: 'text', text: user }],
      maxOutputTokens: 350,
      thinking: 'disabled',
      temperature: 0.1,
      jsonMode: true,
      jsonSchema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['ok'],
      },
    });
    const parsed = extractJson(res.text) as { ok?: boolean; reason?: string };
    const ok = parsed.ok === true;
    return { ok, reason: ok ? undefined : (parsed.reason ?? '사실 오류') };
  } catch (err) {
    if (args.sourceBrief) {
      logger.warn({ err }, '원본 보존 검사 실패 — 미검증 카피를 통과시키지 않음');
      throw new Error('원본 보존 검사를 완료하지 못했습니다. 다시 생성해 주세요.', { cause: err });
    }
    logger.warn({ err }, 'factCheckCopy failed — passing through');
    return { ok: true };
  }
}

/**
 * 이 계정의 최근 리젝 사례 (rejectionReason 있는 것) 최대 5건.
 * 카테고리가 지정되면 같은 카테고리 우선.
 */
async function loadRecentRejections(
  accountId: string,
  productCategory?: string,
): Promise<Array<{ body: string; reason: string }>> {
  try {
    const posts = await prisma.post.findMany({
      where: {
        accountId,
        state: 'REJECTED',
        rejectionReason: { not: null },
        generatedBody: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        generatedBody: true,
        rejectionReason: true,
        commerceProduct: { select: { category: true } },
      },
    });
    const mapped = posts
      .filter((p) => p.generatedBody && p.rejectionReason)
      .map((p) => ({
        body: p.generatedBody as string,
        reason: p.rejectionReason as string,
        category: p.commerceProduct?.category,
      }));
    // 같은 카테고리 우선, 그다음 최신
    const sameCat = productCategory
      ? mapped.filter((m) => m.category && m.category === productCategory)
      : [];
    const others = mapped.filter((m) => !sameCat.includes(m));
    return [...sameCat, ...others].slice(0, 5).map(({ body, reason }) => ({ body, reason }));
  } catch (err) {
    logger.warn({ err }, 'loadRecentRejections failed');
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Line B — 미니 큐레이션 (상품 2~3개 묶음) 전용 카피/리플
//   단일 상품 카피와 보이스 규칙(UNIVERSAL_PRINCIPLES)은 동일하되,
//   "요즘 몇 개 찾아본 것들" 톤으로 미니 세트를 한 문장에 담는다.
//   판매·비교·최저가 톤 금지(기존 금지 어휘 그대로). 링크는 고정댓글로만.
// ─────────────────────────────────────────────────────────────────────────

export interface CurationCopyInput {
  personaPrompt?: string;
  accountSeed: string;
  accountId?: string;
  categoryKr: string; // 테마 (예: "뷰티", "주방")
  productNames: string[]; // 2~3개
  seedIndex?: number;
}

export async function generateCurationBody(input: CurationCopyInput): Promise<string> {
  const persona = input.personaPrompt?.trim() || NEUTRAL_PERSONA;
  const seedIndex = input.seedIndex ?? 0;
  const system = `${UNIVERSAL_PRINCIPLES}

== 이 계정의 페르소나 (seed=${input.accountSeed}, variant=${seedIndex}) ==
${persona}

페르소나는 위 공통 원칙 안에서 어투·문체를 조절한다. 없는 체험이나 상품 장점 설명을 추가하지 않는다.

== 이번 글의 특수 규칙 (미니 큐레이션) ==
- 상품 하나가 아니라 **같은 테마로 요즘 찾아본 몇 개**를 가볍게 언급하는 글이다.
- "요즘 ○○ 뭐 쓸지 고민하다 찾아본 것들" 같은 **발견·고민 훅**. 판매·비교·추천 톤 절대 X.
- 상품명을 그대로 나열하지 마라. 테마(용도·상황)만 자연스럽게. 개수는 "몇 개" 정도로만 암시 가능.
- 링크·가격·브랜드 나열 금지 (링크는 고정댓글).`;

  const userText = `테마: ${input.categoryKr}
이번에 묶은 상품(참고용, 그대로 노출 금지): ${input.productNames.map((n) => n.slice(0, 40)).join(' / ')}

위 테마로 "요즘 찾아본 것들" 느낌의 본문 문장 1개를 JSON으로만 반환.`;

  const generateOnce = async (idx: number, avoid?: string): Promise<string> => {
    const parts: LlmContentPart[] = [{ type: 'text', text: userText }];
    if (avoid) {
      parts.push({
        type: 'text',
        text: `⛔ 방금 실패 사유 · 이번엔 반드시 회피: ${avoid}`,
      });
    }
    const response = await llm().complete({
      tier: 'main',
      system: system.replace(`variant=${seedIndex}`, `variant=${idx}`),
      userParts: parts,
      maxOutputTokens: 400,
      temperature: 0.9 + idx * 0.05,
      jsonMode: true,
      thinking: 'disabled',
      jsonSchema: {
        type: 'object',
        properties: { body: { type: 'string' } },
        required: ['body'],
      },
    });
    return BodyResultSchema.parse(extractJson(response.text)).body;
  };

  // 개인정보(자녀·직업 등)·사실 검증 — 페르소나가 가족/직업을 새게 만드는 것 방지.
  // 큐레이션은 대표 상품명·카테고리를 컨텍스트로 넘겨 정책 검사를 활성화한다.
  let body = await generateOnce(seedIndex);
  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const check = await factCheckCopy({
      body,
      productName: input.productNames[0],
      productCategory: input.categoryKr,
    });
    if (check.ok) break;
    logger.warn({ attempt, body, reason: check.reason }, 'curation copy fact-check 실패 → 재생성');
    body = await generateOnce(seedIndex + attempt + 1, check.reason);
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline C — 일상글 (상품·커머스 없음)
//   소스 URL(귀여운 동물·공감 콘텐츠 등)의 소재·훅만 참고해 페르소나 톤의 일상 공감 글 1문장.
//   상품·가격·구매링크 없음. 고정댓글 없음. 개인정보 누출 검사 포함.
// ─────────────────────────────────────────────────────────────────────────

export interface DailyCopyInput {
  personaPrompt?: string;
  accountSeed: string;
  accountId?: string;
  sourceText?: string;
  sourceLanguage?: string | null;
  sourceImageUrl?: string;
}

export async function generateDailyBody(input: DailyCopyInput): Promise<string> {
  const baseSystem = buildSystemPrompt({
    personaPrompt: input.personaPrompt,
    accountSeed: input.accountSeed,
    variantIndex: 0,
    sourceLanguage: input.sourceLanguage ?? null,
  });
  const system = `${baseSystem}

== 이번 글의 특수 규칙 (일상글 · 수익화 아님) ==
**★★ 원본 캡션(문장)의 "뜻"을 그대로 옮겨라. 이게 최우선이다.**
- 원본이 말하는 그 내용·의도를 이 페르소나 어투로 자연스럽게 옮긴다. 새로 창작하거나 딴 얘기로 바꾸지 마라.
- **영상 화면을 보고 내용을 "추측·해석"하지 마라.** 풍자·개념·밈 영상은 프레임만 보면 엉뚱하게 해석된다.
  예) 원본 캡션 "男人的腦🤣"(=남자의 뇌/머릿속 풍자):
     나쁨: "그림 커팅 영상 손 떨림 신기함" ← 프레임 보고 지어낸 딴소리
     좋음: "남자 머릿속 실화냐ㅋㅋㅋ" · "남자 뇌 구조 이런 거였음?ㅋㅋ" ← 캡션 뜻 그대로
- 캡션이 짧으면(예: "웃겨") 그 감정만 담백하게 ("완전 웃김ㅋㅋ"). 없는 상황·구체 내용 지어내기 금지.
- 외국어 캡션은 자연스러운 한국어로 뜻만 옮김(딱딱한 직역 X). 억지 부연·지어낸 가정("~하면 빡침")·설명충·시적 은유 금지.
- 검증 불가한 규정(장르·AI·브랜드·인물 단정) 금지. 상품·가격·링크 언급 X (커머스 없음).`;

  const buildOnce = async (idx: number, avoid?: string): Promise<string> => {
    const parts: LlmContentPart[] = [];
    if (input.sourceImageUrl) parts.push({ type: 'image', url: input.sourceImageUrl });
    if (input.sourceText) {
      parts.push({
        type: 'text',
        text: `참고 원문 — 소재·훅만, 직역 금지:\n"""\n${input.sourceText.slice(0, 800)}\n"""`,
      });
    }
    if (avoid) parts.push({ type: 'text', text: `⛔ 방금 실패 사유 · 이번엔 반드시 회피: ${avoid}` });
    parts.push({ type: 'text', text: '일상 공감 글 문장 1개를 JSON으로만 반환.' });
    if (parts.length === 0) throw new Error('generateDailyBody needs sourceText or sourceImageUrl');

    const response = await llm().complete({
      tier: 'main',
      system: system.replace('variant=0', `variant=${idx}`),
      userParts: parts,
      maxOutputTokens: 400,
      temperature: 0.9 + idx * 0.05,
      jsonMode: true,
      thinking: 'disabled',
      jsonSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
    });
    return BodyResultSchema.parse(extractJson(response.text)).body;
  };

  let body = await buildOnce(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    const check = await factCheckCopy({ body }); // 상품 없음 → 개인정보·정책만 검사
    if (check.ok) break;
    logger.warn({ attempt, body, reason: check.reason }, 'daily copy 개인정보/정책 위반 → 재생성');
    body = await buildOnce(attempt + 1, check.reason);
  }
  return body;
}

export async function generateBodyVariants(
  input: CopywriteInput,
  count = 3,
): Promise<string[]> {
  const variants: string[] = [];
  if (count <= 0) return variants;
  const sourceBrief = await analyzeSource(input, (request) => llm().complete(request));
  for (let i = 0; i < count; i++) {
    variants.push(await generateBody({ ...input, sourceBrief }, i));
  }
  return variants;
}

/**
 * 여러 계정 각각의 페르소나로 카피 생성.
 * 같은 원본을 5계정에 각기 다르게 재창조할 때 사용.
 */
export interface PerAccountInput {
  accountId: string;
  personaPrompt: string;
}

export interface PerAccountResult {
  accountId: string;
  body: string;
  reply: string;
}

export async function generateForAccounts(
  input: Omit<CopywriteInput, 'personaPrompt' | 'accountSeed'>,
  accounts: PerAccountInput[],
): Promise<PerAccountResult[]> {
  const results: PerAccountResult[] = [];
  if (accounts.length === 0) return results;
  const sourceBrief = await analyzeSource(input, (request) => llm().complete(request));
  for (const acc of accounts) {
    const body = await generateBody(
      { ...input, sourceBrief, personaPrompt: acc.personaPrompt, accountSeed: acc.accountId },
      0,
    );
    results.push({
      accountId: acc.accountId,
      body,
      reply: buildReply(input.deeplinkUrl),
    });
  }
  return results;
}
