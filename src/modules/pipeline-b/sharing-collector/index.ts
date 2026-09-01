import { createHash } from 'node:crypto';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import {
  runActorSync,
  isApifyConfigured,
  ApifyNotConfiguredError,
} from '../../../infra/apify-client.js';
import { tagBenchmarkPost } from '../../shared/source-collector/viralfactors-tagger.js';
import { embedBenchmark } from '../../shared/source-collector/embedder.js';
import { isVoyageConfigured } from '../../../infra/voyage-client.js';
import { ContentType, InboundPlatform } from '@prisma/client';

/**
 * Pipeline B (팔로워 부스팅) 전용 · 스하리 해시태그 벤치마크 수집기.
 *
 * 목적:
 *   - "스하리1000명프로젝트" 같은 해시태그로 반응 좋은 스하리 글을 수집
 *   - 우리 계정에서 각색해 스하리 글로 재작성하기 위한 벤치마크 풀 구축
 *   - 쇼핑(SHOPPING)·일상(DAILY) 벤치마크 풀과 완전히 분리 (contentType=SHARING)
 *
 * 흐름:
 *   1) 대상 해시태그 리스트 (HASHTAGS) 순회
 *   2) themineworks/threads-scraper mode=search 로 게시글 수집
 *   3) reply_count ≥ MIN_REPLIES 필터
 *   4) 자기 계정 handle · 이미 수집된 externalPostId 제외
 *   5) BenchmarkPost 로 저장 (contentType=SHARING) → viralFactors 태깅 · 임베딩
 */

/** 수집 대상 해시태그. 필요 시 추가. */
const HASHTAGS = ['스하리1000명프로젝트'];

/** 댓글 수 최소 임계값 (사용자 확정: 20). */
const MIN_REPLIES = 20;

/** 해시태그당 Apify에서 가져올 게시글 상한. */
const MAX_POSTS_PER_TAG = 50;

export interface SharingCollectSummary {
  hashtagsProcessed: number;
  perHashtag: Array<{
    hashtag: string;
    fetched: number;
    passedThreshold: number;
    saved: number;
    duplicates: number;
    errors: string[];
  }>;
  totalSaved: number;
}

export async function collectSharingBenchmarks(): Promise<SharingCollectSummary> {
  if (!isApifyConfigured()) throw new ApifyNotConfiguredError();
  const actorId = env.APIFY_ACTOR_THREADS_KEYWORD;
  if (!actorId) {
    throw new Error('APIFY_ACTOR_THREADS_KEYWORD 미설정 (themineworks/threads-scraper)');
  }

  // 우리 4개 자체 계정 handle · 자기 참조 방지
  const selfAccounts = await prisma.account.findMany({ select: { handle: true } });
  const selfHandles = new Set(selfAccounts.map((a) => a.handle.toLowerCase()));

  const summary: SharingCollectSummary = {
    hashtagsProcessed: 0,
    perHashtag: [],
    totalSaved: 0,
  };

  for (const tag of HASHTAGS) {
    const bucket = {
      hashtag: tag,
      fetched: 0,
      passedThreshold: 0,
      saved: 0,
      duplicates: 0,
      errors: [] as string[],
    };
    summary.perHashtag.push(bucket);

    try {
      const items = await runActorSync<Record<string, unknown>>({
        actorId,
        input: {
          mode: 'search',
          searchQuery: tag,
          maxPosts: MAX_POSTS_PER_TAG,
          includeReplies: false,
          includeReposts: false,
          proxyConfiguration: { useApifyProxy: true },
        },
        timeoutSecs: 240,
      });

      const posts = items.filter((it) => it._type !== 'info');
      bucket.fetched = posts.length;

      for (const post of posts) {
        try {
          const replies = toNum(post.reply_count) ?? toNum(post.replies_count) ?? 0;
          if (replies < MIN_REPLIES) continue;
          bucket.passedThreshold += 1;

          const authorHandleRaw =
            (post.username as string | undefined) ??
            (post.author as string | undefined) ??
            (post.user_handle as string | undefined) ??
            null;
          if (!authorHandleRaw) continue;
          const authorHandle = authorHandleRaw.replace(/^@/, '').toLowerCase();
          if (selfHandles.has(authorHandle)) continue; // 자기 계정 제외

          const permalink =
            (post.url as string | undefined) ??
            (post.postUrl as string | undefined) ??
            (post.permalink as string | undefined);
          if (!permalink) continue;

          const externalPostId =
            (post.code as string | undefined) ??
            (post.pk as string | undefined) ??
            (post.id as string | undefined) ??
            derivePostIdFromUrl(permalink);
          if (!externalPostId) continue;

          const text =
            (post.text as string | undefined) ??
            (post.caption as string | undefined) ??
            '';
          if (text.trim().length < 3) continue;

          const mediaUrls = extractMediaUrls(post);
          const contentHash = computeContentHash(text, mediaUrls);

          // dedup: platform+externalPostId 또는 contentHash
          const dup = await prisma.benchmarkPost.findFirst({
            where: {
              OR: [
                { platform: InboundPlatform.THREADS, externalPostId },
                { contentHash },
              ],
            },
            select: { id: true },
          });
          if (dup) {
            bucket.duplicates += 1;
            continue;
          }

          const publishedAt = parseDate(post.posted_at ?? post.taken_at ?? post.timestamp);

          const bench = await prisma.benchmarkPost.create({
            data: {
              platform: InboundPlatform.THREADS,
              sourceHandle: authorHandle,
              externalPostId,
              permalink,
              contentHash,
              text,
              mediaUrls,
              contentType: ContentType.SHARING,
              likesCount: toNum(post.like_count) ?? 0,
              repliesCount: replies,
              repostsCount: toNum(post.repost_count) ?? 0,
              quotesCount: toNum(post.quote_count) ?? 0,
              publishedAt,
            },
          });
          bucket.saved += 1;
          summary.totalSaved += 1;

          // best-effort 태깅 · 임베딩
          tagBenchmarkPost(bench.id).catch((err) =>
            logger.warn({ err, id: bench.id }, 'sharing benchmark tag failed'),
          );
          if (isVoyageConfigured()) {
            embedBenchmark(bench.id).catch((err) =>
              logger.warn({ err, id: bench.id }, 'sharing benchmark embed failed'),
            );
          }
        } catch (err) {
          bucket.errors.push(`post: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      bucket.errors.push(`hashtag ${tag}: ${(err as Error).message}`);
      logger.error({ err, hashtag: tag }, 'sharing hashtag collect failed');
    } finally {
      summary.hashtagsProcessed += 1;
    }
  }

  logger.info({ summary }, 'sharing hashtag benchmarks collected');
  return summary;
}

/**
 * 크론 등에서 안전 호출용. Apify 미설정 시 skip.
 */
export async function safeCollectSharingBenchmarks(): Promise<SharingCollectSummary | null> {
  if (!isApifyConfigured() || !env.APIFY_ACTOR_THREADS_KEYWORD) {
    logger.info('sharing collector skip: Apify 또는 threads keyword actor 미설정');
    return null;
  }
  try {
    return await collectSharingBenchmarks();
  } catch (err) {
    logger.error({ err }, 'sharing collector failed');
    return null;
  }
}

// ---------- helpers ----------

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function extractMediaUrls(post: Record<string, unknown>): string[] {
  const arr =
    (post.media_urls as unknown[] | undefined) ??
    (post.image_urls as unknown[] | undefined) ??
    (post.media as unknown[] | undefined) ??
    [];
  return arr.filter((u): u is string => typeof u === 'string');
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v * (v > 1e12 ? 1 : 1000));
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function derivePostIdFromUrl(url: string): string | null {
  const m = url.match(/\/post\/([A-Za-z0-9_-]+)/) ?? url.match(/\/([A-Za-z0-9_-]{6,})\/?$/);
  return m?.[1] ?? null;
}

function computeContentHash(text: string, mediaUrls: string[]): string {
  const primary = mediaUrls[0] ?? '';
  return createHash('sha256').update(text.trim() + '|' + primary).digest('hex');
}
