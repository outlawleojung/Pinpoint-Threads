import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { llm } from '../../../infra/llm/index.js';

/**
 * viralFactors AI 태깅 (Task #25).
 *
 * BenchmarkPost 원문 → Claude로 6가지 축 구조 분해 → JSON 태그 저장.
 *
 * 태깅 완료 시:
 *   - viralFactors JSON에 결과 저장
 *   - taggedAt = now
 *
 * Copywriter는 나중에 이 태그를 few-shot 힌트로 활용:
 *   - 유사 hook_type + topic_category 상위 3개를 참고
 *   - Voyage RAG(#26) 도입 전까지 카테고리 필터 기반 검색
 */

const HOOK_TYPES = [
  'shock_discovery',   // "이거 진짜 미쳤어" · 충격 발견
  'personal_story',    // 개인 경험 · 사연
  'question',          // 질문형 훅
  'contradiction',     // 통념 뒤집기 · 반전
  'list',              // "3가지" · "5개" 리스트
  'confession',        // 고백 · 후회
  'observation',       // 관찰 · 일상 발견
  'recommendation',    // 추천 · "이거 사세요"
  'warning',           // 경고 · 주의 · "이거 조심"
  'comparison',        // A vs B 비교
  'tip',               // 노하우 · 꿀팁 공유
  'other',
] as const;

const STRUCTURES = [
  'problem_solution',
  'story_reveal',
  'question_answer',
  'listicle',
  'comparison',
  'before_after',
  'tip_share',
  'monologue',
  'other',
] as const;

const TONES = [
  'friendly_casual',
  'authoritative',
  'humorous',
  'emotional',
  'analytical',
  'confessional',
  'inspirational',
  'sarcastic',
  'other',
] as const;

const LENGTH_BUCKETS = ['short_1_2_sentences', 'medium_3_5_sentences', 'long_6_plus'] as const;

const CTA_TYPES = [
  'implicit_curiosity',
  'question_to_reader',
  'invitation',
  'direct_link',
  'no_cta',
  'other',
] as const;

const TOPIC_CATEGORIES = [
  'beauty_skincare',
  'beauty_makeup',
  'fashion',
  'home',
  'kitchen',
  'baby_kids',
  'parenting',
  'pet',
  'health',
  'food',
  'tech',
  'money',
  'travel',
  'entertainment',
  'self_development',
  'shopping_review', // 제품 비교·리뷰 (중립 카테고리 애매할 때)
  'lifestyle',
  'other',
] as const;

const ViralFactorsSchema = z.object({
  hook_type: z.enum(HOOK_TYPES),
  structure: z.enum(STRUCTURES),
  tone: z.enum(TONES),
  length_bucket: z.enum(LENGTH_BUCKETS),
  cta_type: z.enum(CTA_TYPES),
  topic_category: z.enum(TOPIC_CATEGORIES),
  key_phrase: z.string().max(80),
  reasoning: z.string().max(200),
});

export type ViralFactors = z.infer<typeof ViralFactorsSchema>;

const SYSTEM_PROMPT = `너는 SNS(Threads·인스타) 콘텐츠 분석가다.
주어진 게시글이 왜 반응이 좋았는지 구조적으로 분해해 JSON으로 반환한다.

각 축의 값은 반드시 아래 목록에서만 골라라. 목록에 없는 값·자유형 문자열 금지.
애매하면 가장 가까운 것을 고르고, 정말 어느 쪽도 아닐 때만 "other".
"other"는 마지막 수단이다. 조금이라도 해당하는 카테고리가 있으면 그것을 선택하라.

hook_type (첫 문장·훅 유형):
${HOOK_TYPES.map((v) => `  - ${v}`).join('\n')}

structure (전체 흐름):
${STRUCTURES.map((v) => `  - ${v}`).join('\n')}

tone (문체·감정):
${TONES.map((v) => `  - ${v}`).join('\n')}

length_bucket (분량):
${LENGTH_BUCKETS.map((v) => `  - ${v}`).join('\n')}

cta_type (독자 유도 방식):
${CTA_TYPES.map((v) => `  - ${v}`).join('\n')}

topic_category (소재):
${TOPIC_CATEGORIES.map((v) => `  - ${v}`).join('\n')}
  * 제품 비교·리뷰는 shopping_review
  * 유아·육아는 baby_kids 또는 parenting
  * 반려동물은 pet
  * 여행 후기·정보는 travel
  * 신발·의류·가방은 fashion (health 아님, 발 건강 언급 있어도 신발은 fashion)

key_phrase: 이 게시글의 시그니처 표현 (최대 80자, 원문 언어)
reasoning: 왜 이 분류인지 (최대 200자)

원본 언어 무관 (한/영/중/일 지원). 분류만 정확히.
출력: JSON 오브젝트만. 다른 텍스트·마크다운 금지.`;

export async function tagBenchmarkPost(benchmarkPostId: string): Promise<ViralFactors> {
  const post = await prisma.benchmarkPost.findUnique({ where: { id: benchmarkPostId } });
  if (!post) throw new Error(`BenchmarkPost ${benchmarkPostId} not found`);
  if (!post.text || post.text.length < 5) {
    throw new Error(`BenchmarkPost ${benchmarkPostId} text too short`);
  }

  const response = await llm().complete({
    tier: 'fast', // Haiku로 충분
    system: SYSTEM_PROMPT,
    userParts: [
      {
        type: 'text',
        text: `게시글:\n"""\n${post.text}\n"""\n\n좋아요: ${post.likesCount} · 댓글: ${post.repliesCount} · 리포스트: ${post.repostsCount}\n\nJSON으로만 분석 결과 반환:`,
      },
    ],
    maxOutputTokens: 512,
    temperature: 0.2,
    jsonMode: true,
    jsonSchema: {
      type: 'object',
      properties: {
        hook_type: { type: 'string', enum: [...HOOK_TYPES] },
        structure: { type: 'string', enum: [...STRUCTURES] },
        tone: { type: 'string', enum: [...TONES] },
        length_bucket: { type: 'string', enum: [...LENGTH_BUCKETS] },
        cta_type: { type: 'string', enum: [...CTA_TYPES] },
        topic_category: { type: 'string', enum: [...TOPIC_CATEGORIES] },
        key_phrase: { type: 'string', maxLength: 80 },
        reasoning: { type: 'string', maxLength: 200 },
      },
      required: [
        'hook_type',
        'structure',
        'tone',
        'length_bucket',
        'cta_type',
        'topic_category',
        'key_phrase',
        'reasoning',
      ],
    },
  });

  const cleaned = response.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonStr = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`LLM returned non-JSON: ${cleaned.slice(0, 200)}`);
  }

  // enum 검증 실패 시 유연하게 처리: safeParse 후 실패 필드는 'other'로 fallback
  const validated = ViralFactorsSchema.safeParse(parsed);
  const factors: ViralFactors = validated.success
    ? validated.data
    : coerceWithFallback(parsed as Record<string, unknown>);

  await prisma.benchmarkPost.update({
    where: { id: benchmarkPostId },
    data: {
      viralFactors: factors as unknown as any,
      taggedAt: new Date(),
    },
  });

  logger.info(
    {
      benchmarkPostId,
      hook: factors.hook_type,
      topic: factors.topic_category,
      key_phrase: factors.key_phrase.slice(0, 40),
    },
    'benchmark tagged',
  );

  return factors;
}

/**
 * enum 검증 실패 시 안전 fallback (모르는 값 → 'other').
 */
function coerceWithFallback(raw: Record<string, unknown>): ViralFactors {
  const safe = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => {
    return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : def;
  };
  return {
    hook_type: safe(raw.hook_type, HOOK_TYPES, 'other'),
    structure: safe(raw.structure, STRUCTURES, 'other'),
    tone: safe(raw.tone, TONES, 'other'),
    length_bucket: safe(raw.length_bucket, LENGTH_BUCKETS, 'medium_3_5_sentences'),
    cta_type: safe(raw.cta_type, CTA_TYPES, 'other'),
    topic_category: safe(raw.topic_category, TOPIC_CATEGORIES, 'other'),
    key_phrase: String(raw.key_phrase ?? '').slice(0, 80),
    reasoning: String(raw.reasoning ?? '').slice(0, 200),
  };
}

/**
 * 배치 태깅: taggedAt IS NULL인 벤치마크 상위 N개.
 * cron으로 주기 실행 (신규 벤치마크가 축적되면 자동 태깅).
 */
export async function tagUntaggedBenchmarks(limit = 20): Promise<{ tagged: number; failed: number }> {
  const targets = await prisma.benchmarkPost.findMany({
    where: { taggedAt: null },
    orderBy: { likesCount: 'desc' },
    take: limit,
    select: { id: true },
  });

  let tagged = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      await tagBenchmarkPost(t.id);
      tagged += 1;
    } catch (err) {
      logger.warn({ err, benchmarkPostId: t.id }, 'tag failed');
      failed += 1;
    }
  }

  logger.info({ tagged, failed, total: targets.length }, 'batch tagging done');
  return { tagged, failed };
}
