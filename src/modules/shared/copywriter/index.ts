import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { searchSimilar, type SimilarBenchmark } from '../source-collector/embedder.js';
import { isVoyageConfigured } from '../../../infra/voyage-client.js';

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
  channel?: 'COUPANG' | 'MUSINSA';
  variantCount?: number;
  ragEnabled?: boolean; // Voyage RAG로 유사 벤치마크 top-K few-shot
  ragTopK?: number;
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
- **Threads는 반말이 기본이다.** 존댓말은 특정 페르소나가 명시적으로 요구할 때만.
  일반적으로 "~함/~더라/~인 듯/~됐다/~해봤는데" 반말 어미 사용.
  페르소나에 "존댓말" 지시가 없거나 "반말 기본" 이면 무조건 반말.
- **브랜드명·제품명 언급은 OK.** 스레드 실제 톤에도 브랜드가 자주 나온다.
  단, 그 자체가 카피의 목적이 되면 안 됨. "OO 사세요/OO 강추" 같은 판매 톤은 X.
  "요즘 OO 신어봤는데 발이 편함" 처럼 개인 경험 안에 자연스럽게 녹이기.
- **정확한 가격 숫자·"○○% 할인"·"오늘까지"·"타임세일" 금지** (광고 티).
  → "15,900원" · "30% 세일" · "오늘 자정까지" 같은 표현 X.
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

async function generateBody(input: CopywriteInput, seedIndex: number): Promise<string> {
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

  const contextLines: string[] = [];
  if (input.productName) contextLines.push(`상품명(참고, 카피에 노출 금지): ${input.productName}`);
  if (input.productCategory) contextLines.push(`상품 카테고리: ${input.productCategory}`);
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
  const body = await generateBody(input, 0);
  const reply = buildReply(input.deeplinkUrl);
  const result: CopywriteResult = { body, reply };
  logger.debug({ result }, 'generateCopy');
  return result;
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
