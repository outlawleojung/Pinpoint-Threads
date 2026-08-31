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

const ViralFactorsSchema = z.object({
  hook_type: z.enum([
    'shock_discovery',   // 충격 발견 ("이거 진짜 미쳤어")
    'personal_story',    // 개인 경험 스토리
    'question',          // 질문형 훅
    'contradiction',     // 반전 · 통념 뒤집기
    'list',              // 리스트형 (3가지, 5가지 등)
    'confession',        // 고백 · 후회
    'observation',       // 관찰 · 발견
    'other',
  ]),
  structure: z.enum([
    'problem_solution',
    'story_reveal',
    'question_answer',
    'listicle',
    'comparison',
    'monologue',
    'other',
  ]),
  tone: z.enum([
    'friendly_casual',
    'authoritative',
    'humorous',
    'emotional',
    'analytical',
    'confessional',
    'inspirational',
    'other',
  ]),
  length_bucket: z.enum(['short_1_2_sentences', 'medium_3_5_sentences', 'long_6_plus']),
  cta_type: z.enum([
    'implicit_curiosity',
    'question_to_reader',
    'invitation',
    'direct_link',
    'no_cta',
    'other',
  ]),
  topic_category: z.enum([
    'beauty_skincare',
    'beauty_makeup',
    'fashion',
    'home',
    'kitchen',
    'baby_kids',
    'health',
    'food',
    'tech',
    'money',
    'lifestyle',
    'other',
  ]),
  key_phrase: z.string().max(80),
  reasoning: z.string().max(200),
});

export type ViralFactors = z.infer<typeof ViralFactorsSchema>;

const SYSTEM_PROMPT = `너는 SNS(Threads·인스타) 콘텐츠 분석가다.
주어진 게시글이 왜 반응이 좋았는지 구조적으로 분해해 JSON으로 반환한다.

축:
- hook_type: 첫 문장·훅의 유형
- structure: 전체 흐름 구조
- tone: 문체·감정
- length_bucket: 분량
- cta_type: 독자를 어떤 방식으로 움직이는가
- topic_category: 소재
- key_phrase: 이 게시글의 시그니처 표현 (최대 80자)
- reasoning: 왜 이 분류인지 (최대 200자)

원본 언어 무관 (한/영/중/일 지원). 분류만 정확히.

출력: JSON 오브젝트만. 다른 텍스트 금지.`;

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
        hook_type: { type: 'string' },
        structure: { type: 'string' },
        tone: { type: 'string' },
        length_bucket: { type: 'string' },
        cta_type: { type: 'string' },
        topic_category: { type: 'string' },
        key_phrase: { type: 'string' },
        reasoning: { type: 'string' },
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
    hook_type: safe(
      raw.hook_type,
      ['shock_discovery', 'personal_story', 'question', 'contradiction', 'list', 'confession', 'observation', 'other'] as const,
      'other',
    ),
    structure: safe(
      raw.structure,
      ['problem_solution', 'story_reveal', 'question_answer', 'listicle', 'comparison', 'monologue', 'other'] as const,
      'other',
    ),
    tone: safe(
      raw.tone,
      ['friendly_casual', 'authoritative', 'humorous', 'emotional', 'analytical', 'confessional', 'inspirational', 'other'] as const,
      'other',
    ),
    length_bucket: safe(
      raw.length_bucket,
      ['short_1_2_sentences', 'medium_3_5_sentences', 'long_6_plus'] as const,
      'medium_3_5_sentences',
    ),
    cta_type: safe(
      raw.cta_type,
      ['implicit_curiosity', 'question_to_reader', 'invitation', 'direct_link', 'no_cta', 'other'] as const,
      'other',
    ),
    topic_category: safe(
      raw.topic_category,
      ['beauty_skincare', 'beauty_makeup', 'fashion', 'home', 'kitchen', 'baby_kids', 'health', 'food', 'tech', 'money', 'lifestyle', 'other'] as const,
      'other',
    ),
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
