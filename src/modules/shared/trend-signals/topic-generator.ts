import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { getTopActiveSignals } from './index.js';

/**
 * 트렌드 신호 → **쓰레드 발행 가능한 주제(앵글)** 변환기.
 *
 * 문제: 기존 다이제스트는 원시 신호(쿠팡 상품명·카테고리 라벨·Google 급상승어)를
 *   그대로 나열 → "쓰레드에 뭐라고 쓸지"가 없어 글감이 안 됨.
 *
 * 해결: 활성 신호 풀을 LLM 1회로 **두 버킷**의 발행 주제로 변환.
 *   - shopping[] : 실제 트렌드 상품/카테고리 기반 발행 앵글 (비교·최저가·추천·신상) → Line B
 *   - engagement[] : 공감·질문·경험담 훅 (일상·계절). 인물·정치·스포츠·특정개인 하드 드롭.
 *
 * 2라인 아키텍처(ROADMAP)의 "트렌드→주제" 앞단.
 */

const PostableTopicSchema = z.object({
  title: z.string().min(4).max(80),
  angle: z.string().min(2).max(40),
  hook: z.string().min(4).max(160),
  basis: z.string().min(1).max(60),
  category: z.string().max(30).optional(),
});
export type PostableTopic = z.infer<typeof PostableTopicSchema>;

export interface PostableTopics {
  shopping: PostableTopic[];
  engagement: PostableTopic[];
}

export interface TopicGenOptions {
  /** 신호 풀 상한 (기본 60) */
  poolLimit?: number;
  /** 각 버킷 목표 개수 (기본 6) */
  perBucket?: number;
}

const SYSTEM_PROMPT = `너는 SNS(쓰레드) 콘텐츠 기획자다. 원시 트렌드 신호 목록을 받아 **실제로 쓰레드에 발행 가능한 "주제"** 로 바꾼다.

우리 5개 페르소나: 30대남 자취IT · 30대여 유아맘 · 20대여 감성마케팅 · 20대여 3교대홈트 · 40대여 워킹맘실용.

두 종류의 주제를 만든다:

[shopping] — 상품 트렌드 기반 발행 앵글
- 소스: 실제 상품명/쇼핑 카테고리 신호 (쿠팡 랭킹·뷰티·패션 등).
- 관련 상품을 **묶어서** 앵글화: "비교"(A vs B vs C), "최저가/가성비", "요즘 잘나가는 N개", "신상 리뷰".
- title 예: "환절기 저자극 클렌저 3종 비교 — 뭐가 순할까", "여름 쿨링 소품 가성비 top".
- 특정 브랜드 상품명을 그대로 title에 박지 말 것. 카테고리/용도 중심으로 일반화하되 basis에 근거 상품 남긴다.

[engagement] — 일상·공감 대화 훅 (수익화 X)
- 공감/질문/경험담으로 반응(댓글·리포스트) 유도.
- title 예: "요즘 아침마다 이거 하나 챙기면 하루가 다름", "환절기에 다들 뭐 챙겨 드세요?".
- **하드 드롭(engagement에 절대 넣지 말 것)**: 특정 인물·연예인·정치·시사·스포츠 경기/팀·사건사고·주식/투자·특정 지명 이슈.
  이런 급상승어는 계절·날씨·일반 라이프스타일 정도로만 일반화 가능하면 쓰고, 아니면 버린다.
- 개인정보(자녀·직업·구체 취미) 노출 X. 일반 상태만.

각 주제 필드:
- title: 그대로 다이제스트에 노출될 한 줄 주제 (한국어, 후킹).
- angle: 콘텐츠 앵글 (비교 / 최저가 / 추천 / 신상 / 공감 / 질문 / 경험담 중 하나).
- hook: 첫 문장 예시 (한 문장).
- basis: 근거가 된 트렌드 키워드(들). 콤마로 최대 3개.
- category: fashion·beauty·home·health·food·lifestyle·tech 중 (있으면).

품질 우선. 억지로 개수 채우지 말고, 근거가 약하면 적게 낸다.

JSON 객체로만 반환: { "shopping": [ {title,angle,hook,basis,category?} ], "engagement": [ ... ] }`;

export async function generatePostableTopics(
  opts: TopicGenOptions = {},
): Promise<PostableTopics> {
  const poolLimit = opts.poolLimit ?? 60;
  const perBucket = opts.perBucket ?? 6;

  // 쇼핑 신호(카테고리 태깅)와 급상승(null 카테고리) 둘 다 가져온다 — LLM이 분류/드롭.
  const signals = await getTopActiveSignals({ limit: poolLimit });
  if (signals.length === 0) {
    return { shopping: [], engagement: [] };
  }

  const shoppingSignals = signals.filter((s) => s.category != null);
  const risingSignals = signals.filter((s) => s.category == null);

  const listing =
    `[쇼핑/상품 신호 — shopping 버킷 소스]\n` +
    (shoppingSignals.length
      ? shoppingSignals.map((s) => `- [${s.category}] ${String(s.keyword).slice(0, 70)}`).join('\n')
      : '(없음)') +
    `\n\n[급상승 검색어 — engagement 후보(대부분 드롭 대상)]\n` +
    (risingSignals.length
      ? risingSignals.map((s) => `- ${String(s.keyword).slice(0, 50)}`).join('\n')
      : '(없음)');

  const response = await llm().complete({
    tier: 'main',
    system: SYSTEM_PROMPT,
    userParts: [
      {
        type: 'text',
        text:
          `아래 트렌드 신호로 발행 주제를 만들어라. shopping·engagement 각 최대 ${perBucket}개.\n\n` +
          listing +
          `\n\n출력: { "shopping": [...], "engagement": [...] }`,
      },
    ],
    maxOutputTokens: 3500,
    temperature: 0.6,
    jsonMode: true,
    thinking: 'disabled', // 긴 JSON 출력이 thinking에 잘리지 않도록
  });

  const parsed = extractJsonObject(response.text);
  const shopping = coerceTopics((parsed as any)?.shopping).slice(0, perBucket);
  const engagement = coerceTopics((parsed as any)?.engagement).slice(0, perBucket);

  logger.info(
    {
      poolSize: signals.length,
      shoppingSeeds: shoppingSignals.length,
      risingSeeds: risingSignals.length,
      shopping: shopping.length,
      engagement: engagement.length,
    },
    'postable topics generated',
  );

  return { shopping, engagement };
}

function coerceTopics(raw: unknown): PostableTopic[] {
  if (!Array.isArray(raw)) return [];
  const out: PostableTopic[] = [];
  for (const item of raw) {
    const parsed = PostableTopicSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function extractJsonObject(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return {};
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return {};
    }
  }
}
