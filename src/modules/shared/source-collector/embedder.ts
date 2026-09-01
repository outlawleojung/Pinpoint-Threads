import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { embed, embedOne, isVoyageConfigured } from '../../../infra/voyage-client.js';

/**
 * Voyage AI 임베딩 · pgvector 저장 (Task #26).
 *
 * BenchmarkPost.embedding 컬럼은 Prisma Unsupported → raw SQL로 저장·조회.
 *
 * embedBenchmark(id): 단건 임베딩
 * embedUntagged(limit): 배치 (embeddedAt IS NULL 상위)
 * searchSimilar(text, topK, filters): 코사인 유사도 검색 → Copywriter RAG 소스
 */

const BATCH_SIZE = 16;

export interface EmbeddedRecord {
  benchmarkPostId: string;
  dim: number;
  tokens: number;
}

export async function embedBenchmark(benchmarkPostId: string): Promise<EmbeddedRecord> {
  if (!isVoyageConfigured()) throw new Error('VOYAGE_API_KEY not configured');

  const post = await prisma.benchmarkPost.findUnique({
    where: { id: benchmarkPostId },
    select: { id: true, text: true },
  });
  if (!post) throw new Error(`BenchmarkPost ${benchmarkPostId} not found`);
  if (!post.text) throw new Error(`BenchmarkPost ${benchmarkPostId} text empty`);

  const vector = await embedOne(post.text, 'document');
  await savePostEmbedding(post.id, vector);

  logger.info(
    { benchmarkPostId: post.id, dim: vector.length },
    'benchmark embedded',
  );
  return { benchmarkPostId: post.id, dim: vector.length, tokens: 0 };
}

export async function embedUntaggedBatch(limit = BATCH_SIZE): Promise<{
  embedded: number;
  failed: number;
  tokens: number;
}> {
  if (!isVoyageConfigured()) {
    logger.warn('VOYAGE_API_KEY 미설정 → embedder skip');
    return { embedded: 0, failed: 0, tokens: 0 };
  }

  const targets = await prisma.benchmarkPost.findMany({
    where: { embeddedAt: null, text: { not: '' } },
    orderBy: { likesCount: 'desc' },
    take: limit,
    select: { id: true, text: true },
  });
  if (targets.length === 0) return { embedded: 0, failed: 0, tokens: 0 };

  const texts = targets.map((t) => t.text);
  try {
    const { embeddings, totalTokens } = await embed({ texts, inputType: 'document' });
    let embedded = 0;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const vec = embeddings[i];
      if (!target || !vec) continue;
      try {
        await savePostEmbedding(target.id, vec);
        embedded += 1;
      } catch (err) {
        logger.error({ err, benchmarkPostId: target.id }, 'save embedding failed');
      }
    }
    logger.info({ embedded, failed: targets.length - embedded, tokens: totalTokens }, 'batch embed done');
    return { embedded, failed: targets.length - embedded, tokens: totalTokens };
  } catch (err) {
    logger.error({ err, count: targets.length }, 'batch embed API failed');
    return { embedded: 0, failed: targets.length, tokens: 0 };
  }
}

async function savePostEmbedding(id: string, vector: number[]): Promise<void> {
  const vectorLiteral = `[${vector.join(',')}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE "BenchmarkPost"
       SET embedding = $1::vector, "embeddedAt" = NOW()
     WHERE id = $2`,
    vectorLiteral,
    id,
  );
}

/**
 * 유사 벤치마크 검색 (Copywriter RAG용).
 * 새 원본 텍스트를 embedOne(query 모드)으로 임베딩 후 pgvector cosine 유사도 top K.
 */
export interface SimilarBenchmark {
  id: string;
  sourceHandle: string;
  text: string;
  likesCount: number;
  distance: number;
  viralFactors: Record<string, unknown> | null;
}

export interface SearchSimilarInput {
  queryText: string;
  topK?: number;
  categoryFilter?: string; // viralFactors.topic_category 값
  minLikes?: number;
  contentType?: 'SHOPPING' | 'DAILY' | 'SHARING'; // Pipeline별 풀 분리
}

export async function searchSimilar(input: SearchSimilarInput): Promise<SimilarBenchmark[]> {
  if (!isVoyageConfigured()) return [];

  const topK = input.topK ?? 3;
  const minLikes = input.minLikes ?? 0;

  const queryVector = await embedOne(input.queryText, 'query');
  const literal = `[${queryVector.join(',')}]`;

  // pgvector 코사인 거리: `embedding <=> $1::vector` (0=같음, 2=반대)
  // 필터: embedding NOT NULL + minLikes + optional category
  const params: unknown[] = [literal, minLikes];
  let paramIdx = 3;
  let categoryClause = '';
  if (input.categoryFilter) {
    categoryClause = `AND "viralFactors"->>'topic_category' = $${paramIdx}`;
    params.push(input.categoryFilter);
    paramIdx += 1;
  }
  let contentTypeClause = '';
  if (input.contentType) {
    contentTypeClause = `AND "contentType" = $${paramIdx}::"ContentType"`;
    params.push(input.contentType);
    paramIdx += 1;
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      source_handle: string;
      text: string;
      likes_count: number;
      distance: number;
      viral_factors: unknown;
    }>
  >(
    `SELECT
       id,
       "sourceHandle" AS source_handle,
       text,
       "likesCount" AS likes_count,
       (embedding <=> $1::vector) AS distance,
       "viralFactors" AS viral_factors
     FROM "BenchmarkPost"
     WHERE embedding IS NOT NULL
       AND "likesCount" >= $2
       ${categoryClause}
       ${contentTypeClause}
     ORDER BY embedding <=> $1::vector
     LIMIT ${topK}`,
    ...params,
  );

  return rows.map((r) => ({
    id: r.id,
    sourceHandle: r.source_handle,
    text: r.text,
    likesCount: Number(r.likes_count),
    distance: Number(r.distance),
    viralFactors: (r.viral_factors as Record<string, unknown> | null) ?? null,
  }));
}
