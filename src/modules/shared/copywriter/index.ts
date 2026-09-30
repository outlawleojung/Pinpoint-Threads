import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { searchSimilar, type SimilarBenchmark } from '../source-collector/embedder.js';
import { isVoyageConfigured } from '../../../infra/voyage-client.js';
import { prisma } from '../../../db/prisma.js';
import { analyzeSource, renderSourceBrief, type SourceBrief } from './source-brief.js';
import { renderWinningStyle } from './winning-style.js';
import { findLectureExamples, renderLectureExamples, LECTURE_EXAMPLES_ENABLED, RATIONALE_INSTRUCTION, type CopyRationale } from './lecture-examples.js';

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
  /** 자동 완화된 우려사항(예: 사실검사 최종 실패 후 통과시킴). 승인 카드에 경고로 표시. */
  warnings?: string[];
  /** 생성 근거 (원본 상황 · 반응 포인트 · 참고한 강의 사례 틀) — 승인 카드에 표시. */
  rationale?: CopyRationale;
};

export interface CopywriteInput {
  sourceText?: string;
  sourceLanguage?: string | null;
  sourceImageUrl?: string;
  sourceMediaDescription?: string;
  productName?: string;
  productCategory?: string;
  productNote?: string; // 판매자/큐레이터가 준 부연설명 — 원문에 없어도 신뢰 가능한 상품 사실(아이디어 상품 셀링포인트 등)
  correctionInstruction?: string; // 사용자가 카드에 답장으로 준 정정 지시 — 반드시 반영(정정 학습 루프)
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
- **★ "소장각"으로 매번 끝내지 마라.** 특정 마무리 한 단어("소장각"·"소장 욕구")를 글마다 반복하면 티 난다. 마무리·구매욕 표현을 매번 다르게: "이건 사야 됨"·"지갑 위험"·"장바구니 직행"·"눈 돌아감"·"못 참겠다"·"영업 제대로 당함"·"품절 전에 잡아야"·"이런 건 못 지나치지"·"갖고 싶다 진심" 등 각도·어휘를 계정/상품마다 바꾼다.

금지 어휘 (광고 냄새 100% · 강사 GPT 정본):
- 직접 구매유도: 지금 바로 구매, 사러가기, 구매 링크, 할인 중, 최저가, 선착순, 강추/강력 추천.
- 진부한 찬사·스펙: 최고의 제품, 완벽한, 압도적, 필수 아이템, 고성능, OO% 함유, 특허, 가성비/혜자.
- 설명조 종결어미: "~에 좋습니다 / ~해보세요 / ~을 자랑합니다 / ~에 효과적입니다" (상세페이지 말투 = 스크롤 넘김).
- **허용(오히려 권장): 미쳤네/미쳤나, 실화?, 사고 쳤네, 소름, 대박, 진심, 종결, 원탑 템, 갓템, 소장각/소장 욕구, 장난 아님, ㄷㄷ, 순삭.** 반응 강하면 절제 말고 그대로.
- **독자를 부를 땐 "님들"보다 "스친들"**(스레드 친구)을 쓴다. (단 독자에게 대놓고 묻지 마라 — "스친들은 어때?" 류 X)

**개인정보·가족·직업 노출 절대 금지**:
- **게시자 본인의** 자녀·육아·학부모·유치원·학교 노출 X ("우리 애", "내 아기", "육아 중인데" 등 내 아이가 있는 것처럼 쓰기 금지)
  ★ 단 **영상·사진 속 아기/아이를 3인칭으로 가리키는 건 OK**("아기 손목 살", "애기 표정") — 원본 주인공이 아기면 아기를 빼면 글이 성립 안 한다. 커플 소재와 같은 원칙: 관찰은 OK, 내 가족으로 옮기기 X.
- **특정 직업·직종 식별** (간호사·교사·나이트 근무·3교대·야간 근무·워킹맘 등) X
- 결혼·남편·아내·시댁·친정 언급 X
- 나이·연령대 (30대·40대 등) 명시 X
- **★ 원본이 커플·연인·부부 소재여도 그 관계를 게시자 '나'로 옮기지 마라.** "남편이랑/애인이랑 하나씩" 처럼 내 배우자·연인으로 투영 금지. **'커플이 맞춰 신는' 처럼 3인칭 관찰**로만 쓰고, 나는 "나도 하나 갖고 싶다"/"이건 사야겠다" 정도의 구매욕만 표현.
- **일반 사회 상황은 OK**: 회식·외식·출근·퇴근·모임·여행 등 누구나 겪는 상황은 허용.
- **페르소나에 그런 배경이 있어도 신상은 감춘다.** 톤만 반영 · 상품 경험 중심.

줄바꿈(가독성):
- 한두 줄 짜리 짧은 카피는 그대로 한 덩어리로.
- **문장이 길면(3문장 이상 등) 한두 줄씩 묶고 그룹 사이에 빈 줄(\\n\\n)을 넣어** 읽기 쉽게 나눈다.
  한 줄로 죽 이어 쓰지 말 것. 예: "…인정ㅋㅋ\\n\\n근데 갤폴드도…위 아님?\\n\\n이건 취향 싸움…어디 손?"
- 억지로 자르지 말고 의미 단위(감탄→반전→질문 등)로 자연스럽게 끊는다.

출력 포맷:
JSON으로만 반환. 다른 텍스트 금지. 본문 안의 줄바꿈은 \\n 으로.
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

async function generateBody(
  input: CopywriteInput & { sourceBrief: SourceBrief },
  seedIndex: number,
  extraAvoid?: string,
  sink?: { rationale?: CopyRationale },
): Promise<string> {
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

  // 강의 실전 사례 본보기 — ⛔ OFF (LECTURE_EXAMPLES_ENABLED · 전후 비교 개선 없음). 근거 출력 지시만 유지.
  if (!LECTURE_EXAMPLES_ENABLED) userParts.push({ type: 'text', text: RATIONALE_INSTRUCTION });
  else try {
    const ex = await findLectureExamples({
      kind: 'shopping',
      query: [input.productName, input.productCategory, input.sourceBrief?.situation, input.sourceText].filter(Boolean).join('\n'),
    });
    if (ex.good.length) userParts.push({ type: 'text', text: renderLectureExamples(ex) });
    logger.info({ method: ex.method, picked: ex.good.map((c) => c.id) }, 'lecture examples (shopping)');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'lecture examples 실패 — 없이 진행');
  }

  // 사용자 정정 지시 (정정 학습 루프) — 이번 재생성에 반드시 반영. 최우선.
  if (input.correctionInstruction?.trim()) {
    userParts.push({
      type: 'text',
      text:
        `★★ 사용자 정정 지시 — 이번 재생성에 반드시 반영하라 (최우선):\n"""\n${input.correctionInstruction.trim()}\n"""\n` +
        `이전 카피의 이 문제를 확실히 고쳐라. 지시를 무시하거나 표현만 살짝 바꾸지 말고, 정정 내용을 실제로 반영한 새 본문을 쓴다.`,
    });
  }

  // 판매자/큐레이터 부연설명 — 원문에 안 보여도 이 상품의 진짜 셀링포인트(특히 아이디어 상품).
  //   신뢰 가능한 사실로 취급하되, 여기 적힌 것 이상으로 기능·효능을 지어내지 않는다.
  if (input.productNote?.trim()) {
    userParts.push({
      type: 'text',
      text:
        `★ 판매자/큐레이터가 알려준 이 상품의 핵심 (신뢰 가능한 사실 — 원문·이미지에 안 드러나도 사실로 간주하고 활용):\n"""\n${input.productNote.trim()}\n"""\n` +
        `이게 이 상품의 진짜 셀링포인트다. 이걸 중심으로 "왜 갖고 싶은지"를 표현한다. 단, 여기 적힌 것 이상으로 기능·효능·수치를 지어내지 않는다.`,
    });
  }

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

  // 정정 학습 재사용 (Phase 3): 과거 승인된 정정 지시를 미리 반영 → 같은 실수 반복 차단.
  const priorCorrections = await loadRecentCorrections('SHOPPING', input.productCategory);
  if (priorCorrections.length) {
    userParts.push({
      type: 'text',
      text:
        `⚠️ 과거 비슷한 글에서 사용자가 이렇게 정정했다 — 이번엔 미리 반영해서 같은 지적 안 나오게:\n` +
        priorCorrections.map((c, i) => `${i + 1}. ${c}`).join('\n'),
    });
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
        rationale: {
          type: 'object',
          properties: { situation: { type: 'string' }, point: { type: 'string' }, pattern: { type: 'string' } },
        },
      },
      required: ['body'],
    },
  });

  const parsed = extractJson(response.text);
  const { body } = BodyResultSchema.parse(parsed);
  if (sink) sink.rationale = (parsed as { rationale?: CopyRationale })?.rationale;
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

/**
 * JSON 문자열 리터럴 안의 이스케이프 안 된 제어문자(0x00-0x1F)를 \uXXXX 로 이스케이프.
 *   LLM이 "body":"1줄<진짜 줄바꿈>2줄" 처럼 raw 개행을 넣으면 JSON.parse 가 "Bad control character" 로 터짐.
 *   (특히 줄바꿈 지침 이후 발생.) 구조적 공백은 문자열 밖이라 건드리지 않는다.
 */
function escapeControlCharsInStrings(s: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; } // 이스케이프 쌍 보존
      if (c === '"') { inStr = false; out += c; continue; }
      const code = s.charCodeAt(i);
      if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue; }
      out += c;
    } else {
      if (c === '"') inStr = true;
      out += c;
    }
  }
  return out;
}

function extractJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/:\s*undefined\b/g, ': null')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  const candidates = [stripped];
  if (start !== -1 && end !== -1 && end > start) candidates.push(stripped.slice(start, end + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
    try { return JSON.parse(escapeControlCharsInStrings(c)); } catch { /* try next */ }
  }
  throw new Error(`no JSON object in LLM response: ${stripped.slice(0, 200)}`);
}

/**
 * 고정댓글에 딥링크를 몇 번 반복해 붙일지.
 *   Threads 가 고정댓글의 링크를 하나 먹어버려(오류) 터진 글에서 링크가 통째로 사라지는 사고가 있다.
 *   같은 링크를 여러 번 박아 하나라도 살아남게 하는 중복 방어 (사용자 원본 템플릿 · 실전 확인).
 */
export const REPLY_LINK_REPEAT = 3;

export function buildReply(deeplinkUrl: string | undefined): string {
  if (!deeplinkUrl) {
    return LEGAL_DISCLAIMER;
  }
  return [
    '정보 물어보시는 분들 많아서 링크 남겨요 🙌',
    ...Array(REPLY_LINK_REPEAT).fill(deeplinkUrl),
    '',
    LEGAL_DISCLAIMER,
  ].join('\n');
}

export async function generateCopy(input: CopywriteInput): Promise<CopywriteResult> {
  const warnings: string[] = [];
  // 상품명/페르소나로 사건을 재창작하기 전에 원본을 고정. 본문 재시도는 같은 분석을 재사용.
  //   ★ analyzeSource 실패해도 포스트를 죽이지 않는다 — 최소 브리프로 폴백하고 경고만 단다.
  let sourceBrief: SourceBrief;
  try {
    sourceBrief = await analyzeSource(input, (request) => llm().complete(request));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'analyzeSource 실패 → 최소 브리프 폴백');
    const src = (input.sourceText ?? '').trim();
    sourceBrief = {
      situation: src ? src.slice(0, 200) : '원본 정밀 분석 실패 (자동 폴백)',
      points: [{ fact: src ? src.slice(0, 100) : '원본 참고', evidenceType: 'source_text', evidence: src.slice(0, 100) || '원본' }],
      focusIndex: 0,
      allowedChanges: ['한국어 표현·호흡'],
      unknowns: ['원본 정밀 분석 실패'],
    } as SourceBrief;
    warnings.push('원본 보존 분석 실패 → 최소 정보로 생성됨 (원본과 대조 후 승인 권장)');
  }
  const groundedInput = { ...input, sourceBrief };
  const factCheck = input.factCheckEnabled ?? Boolean(input.productName); // 상품 있으면 기본 ON
  const maxRetries = input.factCheckMaxRetries ?? 1; // 비용 절감: 2→1 (최대 2회 생성)

  const sink: { rationale?: CopyRationale } = {};
  let body = await generateBody(groundedInput, 0, input.regenAvoid, sink);
  let lastReason: string | undefined;

  if (factCheck) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const check = await factCheckCopy({
        body,
        productName: input.productName,
        productCategory: input.productCategory,
        sourceBrief,
        sourceText: input.sourceText,
        productNote: input.productNote,
      });
      if (check.ok) break;
      lastReason = check.reason;
      logger.warn(
        { attempt, body, reason: check.reason, productName: input.productName },
        'copy fact-check failed → regenerate',
      );
      if (attempt === maxRetries) {
        // ★ 포스트를 죽이지 않는다. 마지막 본문을 채택하되 경고를 달아 사용자가 최종 판단하게 한다.
        warnings.push(`카피 자동점검 우려: ${check.reason ?? '사실 오류 가능'}`);
        break;
      }
      body = await generateBody(groundedInput, attempt + 1, check.reason, sink);
    }
  }

  // 사용자 스타일 규칙 강제 (장면 서술·대놓고 묻기·사족·감성멘트·정황 재연). 최대 2회 재생성, 그래도면 경고.
  for (let attempt = 0; attempt < 3; attempt++) {
    const style = await styleCheckCopy({ body, sourceText: input.sourceText, kind: 'shopping' });
    if (style.ok) break;
    logger.warn({ attempt, body, reason: style.reason }, 'shopping copy 규칙 위반 → 재생성');
    if (attempt === 2) {
      warnings.push(`규칙 위반 우려: ${style.reason}`);
      break;
    }
    body = await generateBody(groundedInput, attempt + 10, style.reason, sink);
  }

  const reply = buildReply(input.deeplinkUrl);
  const result: CopywriteResult = { body, reply, sourceBrief, warnings: warnings.length ? warnings : undefined, rationale: sink.rationale };
  logger.debug({ result, factCheck, lastReason }, 'generateCopy');
  return result;
}

/**
 * Haiku 사실검증: 카피에 상품 종류·사용처·성분 관련 명백한 오류가 있는지 판정.
 * 예: 열무김치 → 김치찌개 (X), 스킨케어 → 먹는다 (X), 여성 상품 → 남성 언급 (X).
 */
/**
 * ★ 사용자 스타일 규칙 강제 검사 (2026-09-30).
 * 규칙을 프롬프트에 "부탁"만 해서는 생성기가 무시함(모기 영상 장면 서술 · "스친들 뭐임?" 대놓고 묻기 등).
 * 생성 후 이 검사로 위반을 잡아 사유와 함께 재생성한다. 사실·개인정보는 factCheckCopy 담당.
 */
export async function styleCheckCopy(args: {
  body: string;
  sourceText?: string;
  kind: 'daily' | 'shopping';
  /** 영상이 실제로 보여주는 상황(이해 단계 결과) — 글이 이걸 묘사하면 장면 서술 위반. */
  situation?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const system = `너는 한국 Threads 게시글이 **운영자가 정한 스타일 규칙**을 지켰는지 판정하는 검사기다.
아래 위반이 있으면 ok=false, reason에 어떤 규칙을 어떤 문구가 어겼는지 한 줄로. (1번 장면 서술은 엄격하게 · 나머지는 명확할 때만)

1) 장면 서술: 영상·사진에 보이는 장면을 글이 설명한다. (예: "아기 손목 살 틈에 모기가 끼어서 못 나가고 죽어있는 거", "그림자로 개구리 잡는다고 손 움직이는 거 봐")
   → 보는 사람은 영상을 본다. 원문처럼 비유·한마디 반응이어야 한다. (OK: "모닝빵 틈에 낀 모기ㅋㅋ", "역시 남자들이란....ㅋㅋ")
   ★ 영상 속 **표정·동작·모양을 묘사하는 구절이 하나라도** 있으면 위반 (예: "눈이 스르르 감기는 거 실화냐", "동그래져서 눈 감고 있는 거", "스텝까지 따라감"). "저 표정 봐"처럼 가리키기만 하는 건 OK.
   ★ 원문에 없는 장면 디테일을 지어내 덧붙인 것도 위반 (예: 원문 "이가 있으면 제대로 닦아야지🪥"뿐인데 "슬리퍼에 이빨 그려놓고 칫솔질 해주는 거 보고" → 원문에 없는 '그려놓고'를 지어냄 + 장면 서술)
2) 대놓고 묻기: 독자에게 의견·경험·선택을 직접 묻는다. (예: "스친들은 어때?", "뭐임?", "어느 쪽?", "해본 사람?", "너넨?", "A vs B 뭐 고름?")
   ※ 수사적 감탄·반어는 허용: "천재 아님?", "실화냐", "말이 되나", "이게 가능한 일이냐", "일 제대로 안 하냐"
3) 사족: 핵심 한마디 뒤에 설명·감상·교훈·다짐을 덧붙인다.${args.kind === 'daily' ? ' (일상글: 원문보다 눈에 띄게 길어졌으면 사족)' : ''}
4) 감성·힐링·교훈 멘트: "하루 피로가 녹음", "~할 권리 있지", "다정한 사람일수록", "마음이 따뜻해짐" 류.
5) 원작자 정황 재연: 원문 작성자의 매장 방문·여행·가족/연인 관계·구매 경위를 게시자 '나'의 일처럼 씀.${args.kind === 'daily' ? `
6) 원문 이탈: 원문이 주어졌는데 글이 원문의 뜻·웃음 포인트와 무관한 다른 얘기를 한다. (예: 원문 "너무 행복해, 하루 종일 만져도 안 질려" → 글 "저 표정 보고 안 웃는 사람 있으면 나와봐" ✗ / "하루 종일 만져도 안 질릴 듯" ✓)
7) 번역투: 한국 사람이 안 쓰는 직역 문장. (예: "전시회에서 제일 오래 머문 곳" ✗ → "전시회 가서 결국 이거 앞에서 제일 오래 놀다 옴" ✓)` : ''}

JSON만: {"ok": boolean, "reason": "..."}`;
  const user = [
    args.sourceText?.trim() ? `원문: "${args.sourceText.trim().slice(0, 400)}"` : '',
    args.situation ? `영상이 보여주는 상황(글이 이 내용을 묘사·재서술하면 1번 위반): ${args.situation}` : '',
    `게시글: "${args.body}"`,
    '',
    '판정 JSON:',
  ].filter((x, idx) => x || idx >= 3).join('\n');
  try {
    const res = await llm().complete({
      tier: 'fast',
      system,
      userParts: [{ type: 'text', text: user }],
      maxOutputTokens: 200,
      thinking: 'disabled',
      temperature: 0.1,
      jsonMode: true,
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' }, reason: { type: 'string' } }, required: ['ok'] },
    });
    const parsed = extractJson(res.text) as { ok?: boolean; reason?: string };
    const ok = parsed.ok !== false;
    return { ok, reason: ok ? undefined : (parsed.reason ?? '스타일 규칙 위반') };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'styleCheckCopy 실패 — 통과 처리');
    return { ok: true };
  }
}

export async function factCheckCopy(args: {
  body: string;
  productName?: string;
  productCategory?: string;
  sourceBrief?: SourceBrief;
  sourceText?: string;
  productNote?: string;
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
- **게시자 본인의** 자녀·육아·학부모·유치원·학교 노출 ("우리 애", "내 아기", "육아하다가" 등)
  ※ 영상·사진 속 아기/아이를 3인칭으로 말하는 것("아기 손목 살에 모기 낌")은 개인정보 아님 → ok=true
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

  // ★ 원문을 반드시 함께 준다. 없으면 검사기가 "원본에 없는 비교"인지 판단 불가 →
  //   원문에 있는 소문·비교(예: "샤넬112 닮았다는 소문")를 지어낸 걸로 오판해 리젝한다.
  const sourceCtx = args.sourceText?.trim()
    ? `\n원본 캡션(이 안에 있는 사실·소문·타제품 비교는 근거 있음 → 카피가 이를 반영하면 지어낸 것 아님):\n"${args.sourceText.trim().slice(0, 500)}"`
    : args.sourceBrief
      ? `\n원본 상황(근거): ${args.sourceBrief.situation}`
      : '';
  // 판매자 부연설명도 근거로 준다 → 원문에 없어도 이 설명 기반 표현은 지어낸 게 아니다(아이디어 상품 셀링포인트).
  const noteCtx = args.productNote?.trim()
    ? `\n판매자가 알려준 상품 사실(이 내용 기반 표현은 근거 있음 → 지어낸 것 아님):\n"${args.productNote.trim().slice(0, 400)}"`
    : '';
  const user = `${args.productName ? `상품: ${args.productName}${args.productCategory ? ` (카테고리: ${args.productCategory})` : ''}` : '상품 없음 (일상글 · 개인정보·정책만 검사)'}
카피: "${args.body}"${sourceCtx}${noteCtx}

판정 JSON:`;

  try {
    const res = await llm().complete({
      // 팩트·정책 이진 검사 → Haiku(fast)로 충분. 원문을 함께 주므로 근거 판단도 가능(비용 절감).
      tier: 'fast',
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

/**
 * 정정 학습 재사용 (Phase 3) — 과거 사용자가 승인한 정정(approvedFinal)을 같은 유형 생성에 few-shot 주입.
 *   같은 실수 반복 차단 → 무수정 승인율↑. 정정 "지시 텍스트"만 재사용(본문 복붙 아님 · 나쁜 템플릿 재학습 방지).
 *   글로벌(전 계정) 학습 · contentKind 일치 · productType(카테고리) 지정 시 같은 카테고리 우선.
 */
async function loadRecentCorrections(
  contentKind: 'SHOPPING' | 'DAILY' | 'SHARING',
  productType?: string,
): Promise<string[]> {
  try {
    const rows = await prisma.copyCorrection.findMany({
      where: { contentKind, approvedFinal: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { correctionText: true, productType: true },
    });
    const same = productType ? rows.filter((r) => r.productType === productType) : [];
    const others = rows.filter((r) => !same.includes(r));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of [...same, ...others]) {
      const t = r.correctionText.trim();
      const k = t.toLowerCase();
      if (t.length < 2 || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= 5) break;
    }
    return out;
  } catch (err) {
    logger.warn({ err }, 'loadRecentCorrections failed');
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
  /**
   * 사용자가 준 **영상 내용 설명** (캡션 아님).
   * 이게 있으면 "그대로 옮기기"가 아니라 "이 상황에 대한 반응/감상"을 쓴다 (설명 복붙 금지).
   */
  mediaDescription?: string;
  correctionInstruction?: string; // 사용자 정정 지시 — 반드시 반영(정정 학습 루프)
  /** 생성 근거(상황·포인트·참고 강의 사례) 받기 — 승인 카드 표시용. */
  onRationale?: (r: CopyRationale | undefined) => void;
  /** 영상 시점별 프레임(이해용) — 캡션만 보고 장면을 오해하지 않게. 서술 금지 규칙은 그대로. */
  frameImageUrls?: string[];
  /** 규칙 검사를 끝내 통과 못 했을 때 경고(승인 카드에 표시). */
  onWarning?: (w: string) => void;
}

/**
 * 최소 프롬프트 현지화 — 원문 한마디의 웃음 포인트를 한국 사람 말투 한 줄로. (일상글 규칙 위반 시 폴백)
 * 긴 규칙·페르소나 없이 낮은 temperature 로 안정적으로.
 */
async function transcreateCaption(
  sourceText: string,
  understanding: { situation: string; joke: string } | null,
  avoid?: string,
  temperature = 0.4,
): Promise<string> {
  const res = await llm().complete({
    tier: 'main',
    system:
      `해외 SNS 영상 캡션을 한국 Threads 글 한 줄로 옮긴다.
- 원문의 뜻과 웃음 포인트를 유지한다. 다른 얘기로 바꾸지 않는다.
- 직역 금지: 한국 사람이 실제로 쓰는 말투로(~임, ~함, ~듯, ㅋㅋ). 번역투·밋밋한 직역이면 실패.
  예) "展示会でほとんどの時間を過ごした場所" → ✗ "전시회에서 시간을 제일 많이 보낸 곳"(밋밋한 직역) / ✓ "입장료 내고 제일 오래 있던 곳ㅋㅋ"(한국식 말맛으로 같은 웃음)
- 비유는 비유로만: 비유가 가리키는 실제 대상을 풀어 설명하지 않는다(✗ "모닝빵처럼 갈라진 팔뚝 틈" → ✓ "모닝빵 틈").
- 영상 장면을 설명하지 않는다. "영상 상황"에 적힌 내용을 글에 쓰지 않는다(영상이 보여준다). 원문이 말한 것만 옮긴다.
- 원문에 없는 내용을 덧붙이지 않는다. 독자에게 질문하지 않는다.
- 한국에 딱 맞는 말이 있으면 그걸 쓴다(예: "매운 거 못 먹는 나" → "맵찔이인 나", ちぎりパン → 모닝빵).
- 원문처럼 짧게(한 줄, 길어야 두 줄).
JSON만: {"body": "..."}`,
    userParts: [
      {
        type: 'text',
        text:
          `원문: "${sourceText.slice(0, 400)}"` +
          (understanding ? `
영상 상황(참고만, 글에 쓰지 말 것): ${understanding.situation}
원문의 포인트: ${understanding.joke}` : '') +
          (avoid ? `
직전 실패 사유(반복 금지): ${avoid}` : ''),
      },
    ],
    maxOutputTokens: 200,
    temperature,
    jsonMode: true,
    thinking: 'disabled',
    jsonSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
  });
  return BodyResultSchema.parse(extractJson(res.text)).body;
}

export async function generateDailyBody(input: DailyCopyInput): Promise<string> {
  const baseSystem = buildSystemPrompt({
    personaPrompt: input.personaPrompt,
    accountSeed: input.accountSeed,
    variantIndex: 0,
    sourceLanguage: input.sourceLanguage ?? null,
  });
  const specialRules = input.mediaDescription
    ? `== 이번 글의 특수 규칙 (일상글 · 영상 내용 "설명" 기반) ==
**★★ 아래 "영상 내용"은 사람이 영상을 보고 알려준 설명이다. 이걸 그대로 문장으로 옮기지 마라 (1차원적·설명충).**
이 상황을 이해하고, 사람이 그 영상을 보면 할 법한 **진짜 반응·감상 한 줄**을 써라.
- 나쁨(설명 복붙): "엘베 바닥에 구멍 뚫린 것처럼 카페트 깔아놓은 몰카 실화냐" ← 설명을 그대로 나열
- 좋음(반응): "이거 타는 순간 진짜 소리 지를 듯ㅋㅋ 나였으면 못 탐" · "엘베 문 열리자마자 이거면 심장 내려앉음" ← 상황에 대한 반응
- 설명의 모든 디테일을 나열하지 말고, 그 상황의 **핵심 재미·감정 하나**에 반응. 짧고 자연스럽게.
- 없는 사실 지어내기 금지. 상품·가격·링크 X.`
    : `== 이번 글의 특수 규칙 (일상글 · 수익화 아님) ==
**★★ 원본 캡션(문장)의 "뜻"을 그대로 옮겨라. 이게 최우선이다.**
- 원본이 말하는 그 내용·의도를 이 페르소나 어투로 자연스럽게 옮긴다. 새로 창작하거나 딴 얘기로 바꾸지 마라.
- **영상 화면을 보고 내용을 "추측·해석"하지 마라.** 풍자·개념·밈 영상은 프레임만 보면 엉뚱하게 해석된다.
  예) 원본 캡션 "男人的腦🤣"(=남자의 뇌/머릿속 풍자):
     나쁨: "그림 커팅 영상 손 떨림 신기함" ← 프레임 보고 지어낸 딴소리
     좋음: "남자 뇌 구조 이런 거였음?ㅋㅋ" · "남자 머릿속 이게 다임?ㅋㅋ" ← 캡션 뜻 그대로
- 캡션이 짧으면(예: "웃겨") 그 감정만 담백하게 ("완전 웃김ㅋㅋ"). 없는 상황·구체 내용 지어내기 금지.
- **★ 특정 시간대(밤·아침·저녁·새벽·자기 전) 언급 금지.** 이 글이 언제 발행될지 모른다 — 아침에 올라가는데 "밤에"라고 하면 시간이 안 맞아 발행 못 함. 원문에 시간대가 없으면 넣지 마라. (일반 습관·감정 "영상 보는 낙으로 산다" 같은 건 OK.)
- 외국어 캡션은 자연스러운 한국어로 뜻만 옮김(딱딱한 직역 X). 억지 부연·지어낸 가정("~하면 빡침")·설명충·시적 은유 금지.
- 검증 불가한 규정(장르·AI·브랜드·인물 단정) 금지. 상품·가격·링크 언급 X (커머스 없음).`;
  const dailyToneRules = `== 일상글 소재·톤 규칙 (2026-09-28 사용자 방침) ==
- 소재 확장: 귀여운/재밌는 것뿐 아니라 **화제가 된 사건·논란이 된 사건도 OK. 단 정치는 제외.**
- ★**논란·화제는 강하게 편들지 마라.** "이게 맞다/틀리다" 단정 X → **중립인 척 애매하게** 던져라: "이게 맞나 싶다가도 또 그럴 수도 있겠다 싶고", "보는 사람마다 다르겠더라", "뭐가 맞는 건지 은근 갈리던데", 사실만 툭 + "글쎄…". 그래야 양쪽이 댓글로 갈리고(engagement) 계정도 안전(편들다 욕먹기·명예훼손 회피).
- ★**대놓고 "이거 봤어?/어떻게 생각해?/너넨 어때?" 물어보지 마라(하수·티남).** 사실·의견을 툭 던지면 알아서 반응한다: "~했더라", "~가 말이 되나", "~는 좀 아니지".
- ★**특정 문구 남발 금지:** "실화냐 / 말이 되나 / 미쳤다"를 시그니처처럼 반복하지 마라. 같은 감정도 매번 다른 결로("~하는 게 가능한 일이냐", "~ 반칙 아니냐", "~보고 헛웃음 나옴", 담백하게 "~하더라").
== ★★★ 기본 방식 = 원문 캡션 현지화 (창작 아님) — 최우선 ==
- 원문은 해외에서 이미 터진 글이다. 그 **한마디를 한국 사람이 쓴 것처럼 자연스럽게 옮긴다.** 새 반응을 지어내지 않는다.
- **길이 유지**: 원문이 한 줄이면 한 줄. 원문보다 길게 쓰지 마라(덧붙인 설명·감상·질문 = 사족).
- **톤·비유 유지**: 원문의 농담·비유·말장난을 한국식 대응어로(ちぎりパン→모닝빵, 男人的腦→역시 남자들이란). 원문의 웃음 포인트가 한국어로도 웃겨야 한다.
- 직역체 금지: 일본어/중국어 어순·표현이 보이면 실패. 한국 스레드 말투(ㅋㅋ, ~임, ~함, 실화냐)로.
- 원문에 없는 장면 설명 추가 금지(영상이 보여준다).
== ★★ 우리 실측 (2026-09-30 · 일상글 20건) — 이게 최우선 ==
- ⛔★ **영상·사진이 보여주는 장면을 글로 다시 설명하지 마라.** 보는 사람은 영상을 본다. "~가 ~해서 ~하고 있는 거" 식 장면 서술 = 사족. 원문처럼 **비유·한마디 반응만** 짧게.
  예) 원문 "ちぎりパンの隙間に挟まった蚊…逃げ場なくて笑った" → ✅ "모닝빵 사이에 낀 모기ㅋㅋ 빠져나갈 데가 없음" / ⛔ "아기 손목 살 틈에 모기가 끼어서 못 나가고 죽어있는 거ㅋㅋ"(장면 설명)
  예) 원문 "男人的腦🤣" → ✅ "역시 남자들이란....ㅋㅋㅋㅋ"(1.4만뷰, 한 줄)
- 원문이 비유·말장난이면 그 비유를 한국식으로 살려라(ちぎりパン=아기 통통 팔 → 모닝빵·찐빵). 원문이 한 줄이면 우리도 한 줄.
- ⛔ 감성·힐링·교훈 멘트 금지: "하루 피로가 그냥 녹음", "곰인형 가질 권리 있지", "다정한 사람일수록…" (실측 3~100뷰).
== 카피 공식 (강의 정본 · 댓글=조회 엔진) ==
- ★**두괄식:** 결론·킬포인트·후킹포인트를 **첫 줄에**. 첫 줄이 썸네일/인트로라 여기서 스크롤이 멈춘다. 첫 줄은 짧게.
- ★**가독성:** 2줄이면 안 띄워도 됨 · 3줄 이상이면 줄 사이 띄우기 · 4줄 이상이면 2줄+2줄로 분리. 다 띄우지 말고 붙일 건 붙여 강약(리듬감).
- ★**공감(성공보다 실패):** 스레드는 공감의 장. 잘난 자랑보다 실패·삽질·공감 포인트가 응원·댓글을 부른다(단 지어내진 마라).
- ⛔ 이모지·GIF·설문·스포일러 자체는 조회수에 영향 없다 — 장식에 기대지 말고 "사람들이 반응할 내용"이 핵심.
- ★검증된 첫 줄 결(강의 실증, 소재 맞으면 시도·정형 반복은 X): "소심발언합니다" · "제발 ~하지마" · "와 나 지금 소름끼침" · 대상 지목형("~하는 사람한테 경고한다", "영포티 무시하지 마라").
- ★사족 금지: 끝에 설명·마무리 2~3줄 덧붙이지 마라. "여기까지만 딱" — 핵심 한마디에서 끝낸다(참여를 대놓고 요청하는 마무리 X).`;
  const system = `${baseSystem}

${specialRules}

${dailyToneRules}`;

  // 정정 학습 재사용 (Phase 3): 과거 승인된 일상글 정정을 미리 반영 (한 번만 조회).
  const priorCorrections = await loadRecentCorrections('DAILY');

  // 강의 실전 사례 본보기 — ⛔ OFF (LECTURE_EXAMPLES_ENABLED · 전후 비교 개선 없음). 근거 출력 지시만 유지.
  let lectureBlock = LECTURE_EXAMPLES_ENABLED ? '' : RATIONALE_INSTRUCTION;
  if (LECTURE_EXAMPLES_ENABLED) try {
    const ex = await findLectureExamples({
      kind: 'daily',
      query: [input.mediaDescription, input.sourceText].filter(Boolean).join('\n'),
    });
    if (ex.good.length) lectureBlock = renderLectureExamples(ex);
    logger.info({ method: ex.method, picked: ex.good.map((c) => c.id) }, 'lecture examples (daily)');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'lecture examples 실패 — 없이 진행');
  }
  let lastRationale: CopyRationale | undefined;

  // ★ 1단계 이해 (2026-09-30): 영상 프레임+원문으로 상황·원문 포인트만 파악(내부용).
  //   쓰기 단계는 이미지를 안 본다 → 본 걸 글로 풀어쓰는 장면 서술 방지 + 캡션만 보고 지어내는 오해 방지.
  let understanding: { situation: string; joke: string } | null = null;
  if (input.frameImageUrls?.length) {
    try {
      const ures = await llm().complete({
        tier: 'main',
        system:
          '너는 짧은 SNS 영상을 이해하는 분석기다. 영상 시점별 장면과 원문 캡션을 보고 JSON으로만 답한다: ' +
          '{"situation": "영상이 무슨 상황인지 한 줄(물건이 원래 그런 모양인지, 누가 무엇을 하는지 정확히)", ' +
          '"joke": "원문 캡션이 노리는 웃음·포인트가 무엇인지 한 줄(예: 덤덤한 한 줄로 반전을 영상에 맡김 / 비유 / 반어)"}',
        userParts: [
          ...input.frameImageUrls.slice(0, 4).map((u) => ({ type: 'image' as const, url: u })),
          { type: 'text' as const, text: `원문 캡션: "${(input.sourceText ?? '').slice(0, 400)}"` },
        ],
        maxOutputTokens: 300,
        temperature: 0.2,
        jsonMode: true,
        thinking: 'disabled',
        jsonSchema: { type: 'object', properties: { situation: { type: 'string' }, joke: { type: 'string' } }, required: ['situation', 'joke'] },
      });
      const u = extractJson(ures.text) as { situation?: string; joke?: string };
      if (u?.situation) understanding = { situation: u.situation, joke: u.joke ?? '' };
      logger.info({ understanding }, 'daily: 영상 이해');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'daily: 영상 이해 실패 — 원문만으로 진행');
    }
  }

  const buildOnce = async (idx: number, avoid?: string): Promise<string> => {
    const parts: LlmContentPart[] = [];
    if (input.sourceImageUrl) parts.push({ type: 'image', url: input.sourceImageUrl });
    if (understanding) {
      parts.push({
        type: 'text',
        text:
          `영상 이해 (내부 참고용 — 이 내용을 글에 쓰지 마라. 보는 사람은 영상을 직접 본다):
` +
          `- 상황: ${understanding.situation}
- 원문의 웃음/포인트: ${understanding.joke}
` +
          `★ 할 일: 위 "웃음/포인트"를 살려, **한국 사람이 이 영상에 실제로 붙일 법한 자연스러운 한마디**로 다시 쓴다.
` +
          `- 직역 금지: 원문 문장 구조를 옮기면 번역투가 된다(예: "전시회에서 제일 오래 머문 곳" ✗ → "입장료 내고 제일 오래 있던 곳ㅋㅋ" ✓).
` +
          `- 한국식 말맛·관용 표현으로(예: ちぎりパン → 모닝빵). 원문처럼 짧게(한두 줄), 농담 방식(덤덤함·비유·반어)은 유지.
` +
          `- 장면 설명·덧붙임 금지 — 영상이 보여준다.`,
      });
    }
    if (input.mediaDescription) {
      parts.push({
        type: 'text',
        text: `영상 내용 (사람이 알려준 설명 · 그대로 옮기지 말고 이 상황에 반응하라):\n"""\n${input.mediaDescription.slice(0, 800)}\n"""`,
      });
    }
    if (input.sourceText) {
      parts.push({
        type: 'text',
        text: `참고 원문 — 소재·훅만, 직역 금지:\n"""\n${input.sourceText.slice(0, 800)}\n"""`,
      });
    }
    if (input.correctionInstruction?.trim()) {
      parts.push({
        type: 'text',
        text: `★★ 사용자 정정 지시 — 반드시 반영하라 (최우선):\n"""\n${input.correctionInstruction.trim()}\n"""\n표현만 바꾸지 말고 정정 내용을 실제로 반영한 새 문장을 써라.`,
      });
    }
    if (priorCorrections.length) {
      parts.push({
        type: 'text',
        text:
          `⚠️ 과거 일상글에서 사용자가 이렇게 정정했다 — 이번엔 미리 반영해서 같은 지적 안 나오게:\n` +
          priorCorrections.map((c, i) => `${i + 1}. ${c}`).join('\n'),
      });
    }
    if (lectureBlock) parts.push({ type: 'text', text: lectureBlock });
    if (avoid) parts.push({ type: 'text', text: `⛔ 방금 실패 사유 · 이번엔 반드시 회피: ${avoid}` });
    parts.push({ type: 'text', text: '일상 공감 글 문장 1개를 JSON으로만 반환.' });
    if (parts.length === 0) throw new Error('generateDailyBody needs sourceText or sourceImageUrl');

    const response = await llm().complete({
      tier: 'main',
      system: system.replace('variant=0', `variant=${idx}`),
      userParts: parts,
      maxOutputTokens: 400,
      temperature: 0.6 + idx * 0.05, // 0.9 → 0.6 (2026-09-30: 들쭉날쭉 — 같은 입력에 원문 이탈 글이 나감)
      jsonMode: true,
      thinking: 'disabled',
      jsonSchema: {
        type: 'object',
        properties: {
          body: { type: 'string' },
          rationale: { type: 'object', properties: { situation: { type: 'string' }, point: { type: 'string' }, pattern: { type: 'string' } } },
        },
        required: ['body'],
      },
    });
    const parsed = extractJson(response.text);
    lastRationale = (parsed as { rationale?: CopyRationale })?.rationale;
    return BodyResultSchema.parse(parsed).body;
  };

  const verify = async (b: string): Promise<{ ok: boolean; reason?: string }> => {
    const check = await factCheckCopy({ body: b }); // 상품 없음 → 개인정보·정책만 검사
    // 사용자 스타일 규칙(장면 서술·대놓고 묻기·사족·감성멘트·정황 재연·원문 이탈·번역투) 강제 — 부탁이 아니라 검사
    return check.ok
      ? styleCheckCopy({ body: b, sourceText: input.sourceText ?? input.mediaDescription, kind: 'daily', situation: understanding?.situation })
      : check;
  };
  let body = '';
  let passed = false;
  let lastReason: string | undefined;
  // ★ 원문 캡션이 있으면 "원문 한마디 현지화"가 기본 경로 (2026-09-30).
  //   긴 규칙 프롬프트 경로는 영상 이해 내용을 글에 끌어다 써 장면 서술이 반복됨(불닭 "우주까지 가는 거").
  //   사용자 규칙은 아래 verify(사실·스타일 검사)로 그대로 강제된다.
  const captionMode = Boolean(input.sourceText?.trim()) && !input.mediaDescription;
  if (captionMode) {
    for (let attempt = 0; attempt < 3 && !passed; attempt++) {
      try {
        body = await transcreateCaption(input.sourceText!, understanding, lastReason, 0.4 + attempt * 0.1);
        const v = await verify(body);
        if (v.ok) passed = true;
        else {
          lastReason = v.reason;
          logger.warn({ attempt, body, reason: v.reason }, 'daily 현지화 규칙 위반 → 재시도');
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'daily 현지화 실패');
        break;
      }
    }
  }
  if (!passed) body = await buildOnce(0, lastReason);
  for (let attempt = 0; attempt < 3 && !passed; attempt++) {
    const v = await verify(body);
    if (v.ok) {
      passed = true;
      break;
    }
    lastReason = v.reason;
    logger.warn({ attempt, body, reason: v.reason }, 'daily copy 규칙 위반 → 재생성');
    if (attempt === 2) break;
    body = await buildOnce(attempt + 1, v.reason);
  }
  if (!passed) input.onWarning?.(`규칙 위반 우려(자동 수정 실패): ${lastReason ?? '사유 미상'}`);
  input.onRationale?.(lastRationale);
  return body;
}

// ─────────────────────────────────────────────────────────────────────────
// 커스텀 발행 — 사용자가 텔레그램으로 "방향(브리프)"을 직접 지정한 글.
//   소스(영상/캡션)는 맥락 참고, 사용자 방향이 최우선. 커머스 링크가 있으면 고정댓글 리드도 같이 생성.
//   공통 원칙(voice·줄바꿈·스친들·사실 가드·정황 재연 금지)은 그대로 적용.
// ─────────────────────────────────────────────────────────────────────────
export interface CustomBodyInput {
  direction: string; // 사용자가 준 카피 방향/원하는 내용
  personaPrompt?: string;
  accountSeed: string;
  accountId: string;
  sourceText?: string;
  sourceImageUrl?: string;
  sourceLanguage?: string | null;
  withReplyLead?: boolean; // 커머스 링크 있을 때 고정댓글 리드도 생성
}

export async function generateCustomBody(
  input: CustomBodyInput,
): Promise<{ body: string; replyLead?: string }> {
  const baseSystem = buildSystemPrompt({
    personaPrompt: input.personaPrompt,
    accountSeed: input.accountSeed,
    variantIndex: 0,
    sourceLanguage: input.sourceLanguage ?? null,
    shopping: input.withReplyLead, // 커머스면 쇼핑 톤 허용
  });
  const specialRules = `== 이번 글의 특수 규칙 (커스텀 발행 · 사용자가 방향을 직접 지정) ==
**★★ 아래 "요청 방향"이 이 글의 핵심 지시다. 그 의도·각도대로 써라.** 소스(영상/캡션)는 맥락 참고용.
- 요청 방향과 소스를 결합해 자연스러운 한 편으로. 방향이 우선, 소스는 사실 근거·소재.
- **없는 사실 지어내기 금지** — 소스에 있는 것/일반 상식만. 원작자의 특정 정황(매장 방문·여행·국적·관계·구매경위) 재연 금지, 1인칭은 반응·의견만.
${input.withReplyLead
      ? '- 이 글은 **고정댓글에 상품 링크**가 붙는다. 본문은 광고처럼 쓰지 말고 방향대로 흥미·공감·논쟁을 유도. 상품은 지금 링크로 살 수 있다("못 산다/들어오면 산다" 뉘앙스 금지).\n- **replyLead**: 고정댓글 첫 줄 — 광고 티 안 나게 링크(상품/딜)로 자연스럽게 이어주는 한 마디(15~50자, 이모지 최대 1개).'
      : '- 상품·링크 없음. 순수 본문만.'}
- 줄바꿈·"스친들" 호칭·과장 허용 톤은 공통 원칙대로.`;
  const system = `${baseSystem}\n\n${specialRules}`;

  const schema = input.withReplyLead
    ? { type: 'object', properties: { body: { type: 'string' }, replyLead: { type: 'string' } }, required: ['body', 'replyLead'] }
    : { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] };

  const buildOnce = async (idx: number, avoid?: string): Promise<{ body: string; replyLead?: string }> => {
    const parts: LlmContentPart[] = [];
    if (input.sourceImageUrl) parts.push({ type: 'image', url: input.sourceImageUrl });
    parts.push({ type: 'text', text: renderWinningStyle() });
    parts.push({ type: 'text', text: `요청 방향 (이 글의 핵심 지시):\n"""\n${input.direction.slice(0, 1000)}\n"""` });
    if (input.sourceText) {
      parts.push({ type: 'text', text: `소스 원문 (맥락·사실 근거 · 직역 금지):\n"""\n${input.sourceText.slice(0, 800)}\n"""` });
    }
    if (avoid) parts.push({ type: 'text', text: `⛔ 방금 실패 사유 · 이번엔 반드시 회피: ${avoid}` });
    parts.push({ type: 'text', text: `JSON으로만 반환${input.withReplyLead ? ' ({body, replyLead})' : ' ({body})'}.` });

    const response = await llm().complete({
      tier: 'main',
      system: system.replace('variant=0', `variant=${idx}`),
      userParts: parts,
      maxOutputTokens: 500,
      temperature: 0.9 + idx * 0.05,
      jsonMode: true,
      thinking: 'disabled',
      jsonSchema: schema,
    });
    const parsed = extractJson(response.text) as { body?: string; replyLead?: string };
    if (!parsed.body) throw new Error('generateCustomBody: body 누락');
    return { body: parsed.body, replyLead: parsed.replyLead };
  };

  let out = await buildOnce(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    const check = await factCheckCopy({ body: out.body, sourceText: input.sourceText });
    if (check.ok) break;
    logger.warn({ attempt, body: out.body, reason: check.reason }, '커스텀 카피 검증 실패 → 재생성');
    out = await buildOnce(attempt + 1, check.reason);
  }
  return out;
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
