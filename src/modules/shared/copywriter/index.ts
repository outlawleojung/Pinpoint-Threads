import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { searchSimilar, type SimilarBenchmark } from '../source-collector/embedder.js';
import { isVoyageConfigured } from '../../../infra/voyage-client.js';
import { prisma } from '../../../db/prisma.js';

/**
 * Copywriter — 원본을 참고해 계정별 페르소나로 완전 재창조하는 카피 노드.
 *
 * 원칙 (2026-08-31 재정의):
 * - 원본 소재·훅만 참고. 직역·복붙 금지. 소스 언어(ko/en/zh/ja) 무관.
 * - 한국 Threads 피드에 자연스럽게 섞이는 짧은 문장 1개 생성.
 * - **페르소나 프롬프트가 톤·타겟의 유일한 결정 요소.**
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
};

export interface CopywriteInput {
  sourceText?: string;
  sourceLanguage?: string | null;
  sourceImageUrl?: string;
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
const UNIVERSAL_PRINCIPLES = `너는 한국 Threads 피드에 자연스럽게 섞일 짧은 게시글 한 문장을 만드는 도구다.

플랫폼 규칙:
- 문장 1개, 최대 2~3줄, 대략 18~80자 (넘어가도 150자 이내).
- 제목/설명/해설/해시태그/부연 코멘트 절대 금지. 오로지 본문 문장만.
- 광고 카피처럼 보이면 안 됨. 친구가 툭 던진 느낌.
- **문제만 나열 X. 반드시 "왜 이게 좋은지" 한 조각 포함.**
  나쁨: "밑창 지우개마냥 닳더라 결국 바꿈" (문제만, 클릭 이유 없음)
  좋음: "밑창 잘 닳는 신발 지겨웠는데 이건 6개월 신어도 멀쩡" (문제 → 해결 → 증거)
  훅: 문제 · 결론 · 발견 · 놀람 · 반전 중 하나 이상.
  이유: 오래감·편함·가성비·놀란 발견·비교 우위 등 구체적 근거 1개.
- **실제 한국인이 SNS에 흔히 쓰는 자연 어투만.**
  요즘 Threads 유행 말투·단어는 OK (예: "실화냐" "미쳤음" "진심" "레알" 스레드에서 흔함).
  하지만 LLM 창작 은유·억지 비유 절대 금지:
    나쁨: "발바닥이 안 울어" / "밑창이 노래함" / "발이 여행을 떠남" (실사용 X, 어색)
  축약형 어미 (~됨/~옴/~함) 사용 시 반드시 목적어·주어 명확:
    나쁨: "좀 됨" (뭐가?)  좋음: "발이 좀 편해짐"
    나쁨: "이건 좀 이득" (뭐가?)  좋음: "이 가격에 이 퀄이면 이득"
  판정 기준: **처음 본 사람도 즉시 이해 가능해야.** 해석·추론 필요한 문장 X.
- **Threads는 반말이 기본이다.** 존댓말은 특정 페르소나가 명시적으로 요구할 때만.
  일반적으로 "~함/~더라/~인 듯/~됐다/~해봤는데" 반말 어미 사용.
  페르소나에 "존댓말" 지시가 없거나 "반말 기본" 이면 무조건 반말.
- **브랜드명·제품명 언급은 OK.** 스레드 실제 톤에도 브랜드가 자주 나온다.
  단, 그 자체가 카피의 목적이 되면 안 됨. "OO 사세요/OO 강추" 같은 판매 톤은 X.
  "요즘 OO 신어봤는데 발이 편함" 처럼 개인 경험 안에 자연스럽게 녹이기.
- **정확한 가격 숫자·"○○% 할인"·"오늘까지"·"타임세일" 금지** (광고 티).
  → "15,900원" · "30% 세일" · "오늘 자정까지" 같은 표현 X.
- **상품 사용처·조리법·활용 방식 지어내지 X.**
  · 상품 종류에 맞는 표준 사용처만 언급. 확신 없으면 언급 자체를 피해라.
  · 예: 열무김치 → 김치찌개 X (열무는 물김치/열무국수/비빔국수용). 배추김치일 때만 김치찌개.
  · 예: 스킨/토너 → 마시기 X. 마스크팩 → 굽기 X.
  · 상품과 조합할 요리·음식·상황이 애매하면 **일반적 반응만** 남기고 구체 조리법은 빼라.
- **가성비·저렴함을 반응형 문구로 암시하는 건 OK.** 오히려 반응이 잘 나옴.
  → "이게 만원도 안 된다고?" · "이 가격에 이 퀄?" · "생각보다 안 비쌈" · "찾아보고 놀람" OK.
  → 원칙: 구체적 숫자 X, 놀람/발견의 감정 O.
- **구매 링크·구매처("쿠팡/무신사/네이버")를 본문에 쓰지 않음.** 링크는 고정 댓글로만.
- 제품 스펙·성분·기능 나열 금지 (설명서 톤). 상황·행동·감정·발견 중심.

원본 처리 원칙 (매우 중요):
- 원본이 한국어가 아닐 수 있음 (영어·중국어·일본어 등). 언어 상관없이 처리.
- 원본은 **소재와 훅만** 참고. 문장 구조·표현을 그대로 옮기지 말 것.
- 직역 금지. 원본이 말하는 상황·감정·발견을 잡아서 아래 페르소나 톤으로 완전히 새로 작성.
- 원본에 있는 감탄사·이모지·문화 코드를 그대로 옮기지 말 것 (예: "太绝了" → 한국식 감탄으로 치환).
- 원본이 강조하는 훅(놀람·발견·공감·질문 등)의 종류는 유지하되 표현은 완전히 재창조.

금지 어휘 (홍보 냄새):
- 강추, 추천, 가성비, 혜자, 필수템, 존예, 미쳤다, 갓템, 인생템,
  최저가, 할인, 무료배송, 리뷰, 후기, 사용법, 스펙.

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
}): string {
  const persona = input.personaPrompt?.trim() || NEUTRAL_PERSONA;
  const langHint = input.sourceLanguage
    ? `\n\n원본 감지 언어: ${input.sourceLanguage} (직역 금지, 아래 페르소나로 재창조)`
    : '';

  return `${UNIVERSAL_PRINCIPLES}

== 이 계정의 페르소나 (seed=${input.accountSeed}, variant=${input.variantIndex}) ==
${persona}

이 페르소나는 톤·타겟·문체의 유일한 기준이다.
페르소나가 지시하는 대상 독자·어투·이모지 사용 규칙·문화 코드를 정확히 따를 것.${langHint}`;
}

async function generateBody(input: CopywriteInput, seedIndex: number, extraAvoid?: string): Promise<string> {
  const system = buildSystemPrompt({
    personaPrompt: input.personaPrompt,
    accountSeed: input.accountSeed,
    variantIndex: seedIndex,
    sourceLanguage: input.sourceLanguage ?? null,
  });

  const userParts: LlmContentPart[] = [];

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
    contextLines.push(`상품명(참고, 상품명 자체는 카피에 그대로 노출 금지): ${input.productName}`);
    contextLines.push(
      `★ 위 상품명에서 이 상품의 **핵심 장점·특징**을 스스로 추출해서 카피에 반드시 녹여라. ` +
      `(예: "물없이 사용", "5-in-1 · 칫솔+치실+혀클리너", "애플민트향", "개별포장" 같은 실제 특징). ` +
      `원본 게시글의 훅과 이 상품 특징을 결합해서, 독자가 "왜 이게 좋은지" 구체적으로 느끼게 하라. ` +
      `막연한 감상("편하다", "좋다") 만으론 부족 · 상품의 구체적 강점이 드러나야 함.`,
    );
  }
  if (input.productCategory) contextLines.push(`상품 카테고리: ${input.productCategory}`);
  if (extraAvoid) contextLines.push(`⛔ 방금 실패 사유 · 이번엔 반드시 회피: ${extraAvoid}`);
  contextLines.push('본문 문장 1개를 JSON으로만 반환.');
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
  const factCheck = input.factCheckEnabled ?? Boolean(input.productName); // 상품 있으면 기본 ON
  const maxRetries = input.factCheckMaxRetries ?? 1; // 비용 절감: 2→1 (최대 2회 생성)

  let body = await generateBody(input, 0);
  let lastReason: string | undefined;

  if (factCheck) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const check = await factCheckCopy({
        body,
        productName: input.productName,
        productCategory: input.productCategory,
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
      body = await generateBody(input, attempt + 1, check.reason);
    }
  }

  const reply = buildReply(input.deeplinkUrl);
  const result: CopywriteResult = { body, reply };
  logger.debug({ result, factCheck, lastReason }, 'generateCopy');
  return result;
}

/**
 * Haiku 사실검증: 카피에 상품 종류·사용처·성분 관련 명백한 오류가 있는지 판정.
 * 예: 열무김치 → 김치찌개 (X), 스킨케어 → 먹는다 (X), 여성 상품 → 남성 언급 (X).
 */
async function factCheckCopy(args: {
  body: string;
  productName?: string;
  productCategory?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!args.productName) return { ok: true };

  const system = `너는 한국 SNS 쇼핑 카피의 **사실·정책 검사기**다.

다음 중 하나라도 있으면 ok=false:

1) 사실 오류 (상품에 대해 명백히 틀린 표현):
- 상품 종류와 안 맞는 사용처 (예: 열무김치 → 김치찌개 · 열무는 물김치/열무국수용)
- 상품 종류와 안 맞는 조리·활용 방식 (예: 스킨을 마시기, 마스크팩을 굽기)
- 상품 카테고리 오인 (예: 향수를 얼굴에 바르기)
- 성분·기능 근거 없이 지어낸 효능
- 상품이 아닌 것을 상품처럼 언급

2) 개인정보·가족·직업 노출 (정책 위반):
- 자녀·아이·학부모·육아·유치원·학교 관련 언급
- **특정 직업·직종 식별** (간호사·교사·나이트 근무·3교대·워킹맘 등 · 직업을 특정하는 표현)
- 결혼·남편·아내·시댁·친정 언급
- 나이·연령대 (30대·40대 등) 명시
※ **일반 사회 상황은 허용**: 회식·외식·출근길·퇴근·모임·약속·여행 등 누구나 겪는 상황은 직업 노출 아님 → ok=true
  (예: "회식 끝나고 쓰니까 개운함" OK · "야간 근무 중에 썼다" X)

**판정 원칙**: 명백한 오류·정책 위반만 ok=false. 애매한 취향·과장·감정은 ok=true.
문학적 은유·감탄·구어체 흔한 표현은 오류 아님.

JSON으로만: { "ok": boolean, "reason": "짧게 어떤 오류인지 (ok=true면 빈 문자열)" }`;

  const user = `상품: ${args.productName}${args.productCategory ? ` (카테고리: ${args.productCategory})` : ''}
카피: "${args.body}"

판정 JSON:`;

  try {
    const res = await llm().complete({
      tier: 'fast',
      system,
      userParts: [{ type: 'text', text: user }],
      maxOutputTokens: 200,
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
  for (const acc of accounts) {
    const body = await generateBody(
      { ...input, personaPrompt: acc.personaPrompt, accountSeed: acc.accountId },
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
