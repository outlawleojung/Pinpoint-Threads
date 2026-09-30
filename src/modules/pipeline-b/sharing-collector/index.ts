import { createHash } from 'node:crypto';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { tagBenchmarkPost } from '../../shared/source-collector/viralfactors-tagger.js';
import { embedBenchmark } from '../../shared/source-collector/embedder.js';
import { isVoyageConfigured } from '../../../infra/voyage-client.js';
import { ContentType, InboundPlatform } from '@prisma/client';

// ⛔ 수집된 스하리 글의 viralfactors LLM 태깅 스위치 (2026-09-18 · Anthropic 비용 절감으로 기본 OFF).
//   수집(상대 발견)은 태그 없이도 동작. 태그 기반 few-shot 이 다시 필요하면 true.
const VIRALFACTORS_TAG_ENABLED = false;

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
 *   2) 스레드 검색(비로그인 Relay 파싱 · 무료)으로 게시글 수집
 *   3) reply_count ≥ MIN_REPLIES 필터
 *   4) 자기 계정 handle · 이미 수집된 externalPostId 제외
 *   5) BenchmarkPost 로 저장 (contentType=SHARING) → viralFactors 태깅 · 임베딩
 */

/**
 * 수집 대상 해시태그.
 * 단일 태그(#스하리1000명프로젝트)만 쓰면 인기글이 곧 소진돼(dedup) 새 글이 안 들어옴
 * → 매일 같은 풀로 벤치마킹 → 스하리 글이 거기서 거기가 됨.
 * 여러 스하리·맞팔 태그로 우물을 넓혀 원본 다양성 확보. (태그당 Apify 실행 1회 = 비용 비례)
 * 활성/품질 태그는 발행 결과 보며 조정.
 */
// 실측(2026-09-07): #선팔후맞팔 은 검색 0건(죽은 태그) → 제거.
//   #맞팔·#스레드친구 가 신규 다양성의 주 원천, #스하리·#스하리1000명프로젝트 는 포화(코어 seed).
const HASHTAGS = [
  '스하리1000명프로젝트',
  '스하리',
  '맞팔',
  '스레드친구',
];

/** 댓글 수 최소 임계값 (사용자 확정: 20). */
const MIN_REPLIES = 20;

/** 검색 페이지 추가 로드 스크롤 횟수 (1회당 ~6~10건 추가). */
const SEARCH_SCROLLS = 3;

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
  // 2026-09-30: Apify(미결제로 9/21~ 중단) → 비로그인 Relay 파싱(무료)으로 교체. 실측: 태그당 댓글20+ 3~11건.
  const { scrapeThreadsPage } = await import('../../../infra/threads-relay.js');

  // 우리 자체 계정 handle · 자기 참조 방지
  const selfAccounts = await prisma.account.findMany({ select: { handle: true } });
  const selfHandles = new Set(selfAccounts.map((a) => a.handle.toLowerCase()));

  const summary: SharingCollectSummary = {
    hashtagsProcessed: 0,
    perHashtag: [],
    totalSaved: 0,
  };

  // 순차 실행(동시 X) — 차단 위험↓
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
      const posts = await scrapeThreadsPage(
        `https://www.threads.com/search?q=${encodeURIComponent(tag)}&serp_type=default`,
        { scrolls: SEARCH_SCROLLS, locale: 'ko-KR' },
      );
      bucket.fetched = posts.length;

      for (const post of posts) {
        try {
          if (post.replies < MIN_REPLIES) continue;
          bucket.passedThreshold += 1;

          if (!post.username) continue;
          const authorHandle = post.username.toLowerCase();
          if (selfHandles.has(authorHandle)) continue; // 자기 계정 제외

          const externalPostId = post.code;
          const permalink = post.permalink;
          const text = post.text;
          if (text.trim().length < 3) continue;

          const mediaUrls = post.media.map((m) => m.url);
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
              likesCount: post.likes,
              repliesCount: post.replies,
              repostsCount: post.reposts,
              quotesCount: post.quotes,
              publishedAt: post.takenAt,
            },
          });
          bucket.saved += 1;
          summary.totalSaved += 1;

          // best-effort 태깅 · 임베딩
          // ⛔ viralfactors LLM 태깅 기본 OFF (2026-09-18 · Anthropic 비용 절감).
          if (VIRALFACTORS_TAG_ENABLED) {
            tagBenchmarkPost(bench.id).catch((err) =>
              logger.warn({ err, id: bench.id }, 'sharing benchmark tag failed'),
            );
          }
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
 * 크론 등에서 안전 호출용. 실패해도 throw 안 함.
 */
export async function safeCollectSharingBenchmarks(): Promise<SharingCollectSummary | null> {
  try {
    return await collectSharingBenchmarks();
  } catch (err) {
    logger.error({ err }, 'sharing collector failed');
    return null;
  }
}

// ---------- helpers ----------

function computeContentHash(text: string, mediaUrls: string[]): string {
  const primary = mediaUrls[0] ?? '';
  return createHash('sha256').update(text.trim() + '|' + primary).digest('hex');
}
