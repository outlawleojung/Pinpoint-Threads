import { createHash } from 'node:crypto';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import { tagBenchmarkPost } from './viralfactors-tagger.js';
import { embedBenchmark } from './embedder.js';
import { isVoyageConfigured } from '../../../infra/voyage-client.js';
import { InboundSource, type InboundLink } from '@prisma/client';

/**
 * InboundLink → BenchmarkPost 승격 파이프라인.
 *
 * 규칙:
 *   - 자동 승격: engagement.likes ≥ BENCHMARK_AUTO_PROMOTE_MIN_LIKES (기본 3000)
 *   - 수동 승격: /admin/inbound/:id 의 "승격" 버튼
 *   - 승격 후: viralFactors 자동 태깅 + Voyage 임베딩 (best effort)
 *   - dedup: contentHash (text + primary media URL) · platform+externalPostId
 */

const AUTO_MIN_LIKES = env.BENCHMARK_AUTO_PROMOTE_MIN_LIKES;

export type PromoteReason = 'auto' | 'manual';

export interface PromoteResult {
  status: 'promoted' | 'already_promoted' | 'skipped_low_likes' | 'skipped_no_content';
  benchmarkPostId?: string;
  reason?: string;
}

export async function maybeAutoPromote(inboundLink: InboundLink): Promise<PromoteResult> {
  // 원칙: 사용자 수동 시딩(MANUAL_TELEGRAM)은 이미 인간 큐레이션이라 무조건 승격.
  //       자율 트렌드(AUTONOMOUS_TREND)만 likes 임계 검사.
  if (inboundLink.source === InboundSource.MANUAL_TELEGRAM) {
    return promoteInboundLink(inboundLink.id, 'auto');
  }
  const likes = extractLikes(inboundLink.engagement);
  if (likes === null || likes < AUTO_MIN_LIKES) {
    return { status: 'skipped_low_likes', reason: `likes=${likes ?? '?'} < ${AUTO_MIN_LIKES}` };
  }
  return promoteInboundLink(inboundLink.id, 'auto');
}

export async function promoteInboundLink(
  inboundLinkId: string,
  reason: PromoteReason,
): Promise<PromoteResult> {
  const link = await prisma.inboundLink.findUnique({ where: { id: inboundLinkId } });
  if (!link) return { status: 'skipped_no_content', reason: 'InboundLink not found' };
  if (!link.rawText || link.rawText.length < 3) {
    return { status: 'skipped_no_content', reason: 'rawText 없음' };
  }

  // 이미 승격됨?
  const existing = await prisma.benchmarkPost.findUnique({
    where: { inboundLinkId },
    select: { id: true },
  });
  if (existing) {
    return {
      status: 'already_promoted',
      benchmarkPostId: existing.id,
      reason: 'inboundLinkId 매칭 벤치마크 존재',
    };
  }

  const engagement = (link.engagement as Record<string, number> | null) ?? {};
  const contentHash = computeContentHash(link.rawText, link.mediaUrls);
  const externalPostId = deriveExternalPostId(link);

  // platform+externalPostId 또는 contentHash 로 dedup
  const dupByPk = externalPostId
    ? await prisma.benchmarkPost.findUnique({
        where: { platform_externalPostId: { platform: link.platform, externalPostId } },
        select: { id: true },
      })
    : null;
  const dupByHash = await prisma.benchmarkPost.findUnique({
    where: { contentHash },
    select: { id: true },
  });
  const dup = dupByPk ?? dupByHash;
  if (dup) {
    // 승격 표시만 (이 inboundLinkId를 기존 벤치마크에 연결)
    await prisma.benchmarkPost.update({
      where: { id: dup.id },
      data: { inboundLinkId: link.id },
    }).catch(() => {}); // 다른 inboundLink가 이미 연결됐으면 skip
    return {
      status: 'already_promoted',
      benchmarkPostId: dup.id,
      reason: 'contentHash · externalPostId 중복 벤치마크 있음',
    };
  }

  const benchmark = await prisma.benchmarkPost.create({
    data: {
      inboundLinkId: link.id,
      platform: link.platform,
      sourceHandle: link.authorHandle ?? '(unknown)',
      externalPostId: externalPostId ?? link.id,
      permalink: link.url,
      contentHash,
      text: link.rawText,
      mediaUrls: link.mediaUrls,
      likesCount: toNum(engagement.likes),
      repliesCount: toNum(engagement.replies),
      repostsCount: toNum(engagement.reposts),
      quotesCount: toNum(engagement.quotes),
      publishedAt: link.publishedAt,
    },
  });

  logger.info(
    {
      benchmarkPostId: benchmark.id,
      inboundLinkId: link.id,
      platform: link.platform,
      likes: engagement.likes,
      reason,
    },
    'benchmark promoted',
  );

  // 태깅 + 임베딩 병렬 (best effort · 실패해도 승격은 유지)
  const tagPromise = tagBenchmarkPost(benchmark.id).catch((err) => {
    logger.warn({ err, benchmarkPostId: benchmark.id }, 'auto-tag after promote failed');
  });
  const embedPromise = isVoyageConfigured()
    ? embedBenchmark(benchmark.id).catch((err) => {
        logger.warn({ err, benchmarkPostId: benchmark.id }, 'auto-embed after promote failed');
      })
    : Promise.resolve();

  await Promise.all([tagPromise, embedPromise]);

  return { status: 'promoted', benchmarkPostId: benchmark.id, reason };
}

function computeContentHash(text: string, mediaUrls: string[]): string {
  const primary = mediaUrls[0] ?? '';
  return createHash('sha256').update(text.slice(0, 500) + '|' + primary).digest('hex');
}

function deriveExternalPostId(link: InboundLink): string | null {
  // InboundLink는 externalPostId 컬럼 없음 → normalizedUrl 마지막 path segment
  try {
    const u = new URL(link.normalizedUrl);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg || null;
  } catch {
    return null;
  }
}

function extractLikes(engagement: unknown): number | null {
  if (!engagement || typeof engagement !== 'object') return null;
  const e = engagement as Record<string, unknown>;
  const v = e.likes ?? e.likeCount ?? e.likedCount;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return null;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return 0;
}
