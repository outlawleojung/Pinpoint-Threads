import { request } from 'undici';
import { logger } from '../../../../config/logger.js';
import { env } from '../../../../config/env.js';
import { runActorSync, isApifyConfigured } from '../../../../infra/apify-client.js';
import { extractThreadsVideoUrls, pickBestMp4s } from '../../../../infra/playwright-threads-video.js';

export interface ThreadsAdapterInput {
  url: string;
}

export type MediaKind = 'image' | 'video';

export interface ThreadsAdapterResult {
  authorHandle: string | null;
  threadsPostId: string | null;
  permalink: string;
  text: string;
  mediaUrls: string[];
  /** mediaUrls 각 항목의 타입. 길이는 mediaUrls 와 동일. */
  mediaTypes: MediaKind[];
  publishedAt: Date | null;
  language: string | null;
  engagement: {
    likes?: number;
    replies?: number;
    reposts?: number;
    quotes?: number;
  };
  raw: Record<string, unknown>;
  fetchMethod: 'apify' | 'og-fallback';
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export class ThreadsFetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ThreadsFetchError';
  }
}

/**
 * Threads 게시글 fetch — Apify 우선, OG fallback.
 *
 * Meta는 비로그인 서버 요청에 로그인 벽을 반환하므로 OG 파싱은 거의 항상 빈 결과.
 * Apify actor (예: apify/threads-scraper) 가 설정되어 있으면 그것을 사용.
 */
export async function fetchThreadsPost(input: ThreadsAdapterInput): Promise<ThreadsAdapterResult> {
  // /share/ 단축 URL 은 실제 게시글로 리다이렉트 → 최종 URL 해석
  let effectiveUrl = input.url;
  if (/\/share\//i.test(input.url)) {
    const resolved = await resolveShareUrl(input.url);
    if (resolved) {
      logger.info({ from: input.url, to: resolved }, 'threads share URL 해석');
      effectiveUrl = resolved;
    }
  }
  const parsed = parseThreadsUrl(effectiveUrl);
  if (!parsed) {
    throw new ThreadsFetchError(`Not a recognized Threads post URL: ${input.url}`);
  }
  input = { ...input, url: effectiveUrl };

  // Apify 경로
  if (isApifyConfigured() && env.APIFY_ACTOR_THREADS_URL) {
    try {
      return await fetchViaApify(input.url, parsed);
    } catch (err) {
      logger.warn({ err, url: input.url }, 'threads apify fetch failed, falling back to OG');
    }
  }

  // OG fallback (대부분 빈 결과)
  return fetchViaOg(input.url, parsed);
}

async function fetchViaApify(url: string, parsed: ParsedUrl): Promise<ThreadsAdapterResult> {
  const items = await runActorSync<Record<string, unknown>>({
    actorId: env.APIFY_ACTOR_THREADS_URL!,
    input: {
      mode: 'post',
      postUrls: [url],
      maxPosts: 1,
      includeReplies: false,
      includeReposts: false,
      proxyConfiguration: { useApifyProxy: true },
    },
    timeoutSecs: 120,
  });

  const postItems = items.filter(
    (it) => (it as Record<string, unknown>)._type !== 'info',
  );
  if (!postItems.length) {
    throw new ThreadsFetchError(`Apify actor returned 0 post items for ${url}`);
  }

  const item = postItems[0] as Record<string, unknown>;
  return await normalizeApifyItem(item, url, parsed);
}

async function normalizeApifyItem(
  item: Record<string, unknown>,
  url: string,
  parsed: ParsedUrl,
): Promise<ThreadsAdapterResult> {
  const pick = <T = string>(...names: string[]): T | undefined => {
    for (const n of names) {
      const v = item[n];
      if (v !== undefined && v !== null && v !== '') return v as T;
    }
    return undefined;
  };

  const text = (pick<string>('text', 'caption', 'content', 'description', 'postText') as string) ?? '';
  const authorHandle =
    (pick<string>('username', 'authorHandle', 'author', 'ownerUsername', 'user_name') as string) ??
    parsed.authorHandle;

  const mediaUrls: string[] = [];
  const imagesRaw = pick<unknown>(
    'media_urls',
    'mediaUrls',
    'images',
    'imageUrls',
    'media',
    'carouselMedia',
  );
  if (Array.isArray(imagesRaw)) {
    for (const m of imagesRaw) {
      if (typeof m === 'string') mediaUrls.push(m);
      else if (m && typeof m === 'object') {
        const asObj = m as Record<string, unknown>;
        const u = (asObj.url ?? asObj.src ?? asObj.imageUrl ?? asObj.displayUrl) as string | undefined;
        if (u) mediaUrls.push(u);
      }
    }
  }
  const singleImage = pick<string>('imageUrl', 'thumbnailUrl', 'displayUrl', 'image');
  if (singleImage && !mediaUrls.includes(singleImage)) mediaUrls.unshift(singleImage);

  const videoUrl = pick<string>('video_url', 'videoUrl', 'video');
  if (videoUrl && !mediaUrls.includes(videoUrl)) mediaUrls.push(videoUrl);

  // mediaTypes 판정: URL 에 video_default_cover_frame 포함 시 원래 비디오였음
  const mediaTypes: MediaKind[] = mediaUrls.map((u) =>
    u.includes('video_default_cover_frame') || u.includes('.mp4') ? 'video' : 'image',
  );

  const publishedRaw = pick<unknown>(
    'posted_at',
    'publishedAt',
    'timestamp',
    'takenAt',
    'createdAt',
    'date',
  );
  const publishedAt = parseDate(publishedRaw);

  const engagement = {
    likes: toNum(pick<unknown>('like_count', 'likes', 'likeCount', 'likesCount')),
    replies: toNum(
      pick<unknown>('reply_count', 'replies', 'replyCount', 'repliesCount', 'commentsCount'),
    ),
    reposts: toNum(
      pick<unknown>('repost_count', 'reposts', 'repostCount', 'repostsCount', 'sharesCount'),
    ),
    quotes: toNum(pick<unknown>('quote_count', 'quotes', 'quoteCount')),
  };

  const result: ThreadsAdapterResult = {
    authorHandle,
    threadsPostId:
      (pick<string>('code', 'shortcode', 'post_id', 'id', 'postId') as string) ??
      parsed.postShortcode,
    permalink: (pick<string>('url', 'permalink') as string) ?? url,
    text,
    mediaUrls,
    mediaTypes,
    publishedAt,
    language: detectLanguage(text),
    engagement,
    raw: item,
    fetchMethod: 'apify',
  };

  // Playwright 로 비디오 여부 확인 & mp4 URL 획득
  // 실행 트리거 (Apify 가 이미 mp4 잘 리턴하면 스킵 — 이 경우 Playwright 는 오히려 오염원):
  //   1) media_type='video'/'carousel' 인데 mediaUrls 에 mp4 없음 (Apify 가 커버 프레임만 리턴한 경우)
  //   2) mediaUrls 중 video_default_cover_frame 마커 포함 (교체 필요)
  // Playwright 는 이제 shortcode 로 target 게시글 비디오만 정확히 잡음 (추천글 오염 X).
  // Apify 가 mp4 이미 주면 그대로 · 아니면 비디오 게시글일 때 Playwright 로 보강.
  const rawMediaType = String(item.media_type ?? '').toLowerCase();
  const alreadyHasMp4 = result.mediaUrls.some((u) => /\.mp4(?:\?|$)/i.test(u));
  const hasCoverFrameMarker = result.mediaUrls.some((u) => u.includes('video_default_cover_frame'));
  const shouldTryVideo =
    !alreadyHasMp4 && (
      rawMediaType === 'video' ||
      rawMediaType === 'carousel' ||
      hasCoverFrameMarker
    );

  if (shouldTryVideo) {
    try {
      const { mp4Urls } = await extractThreadsVideoUrls(url);
      const bestMp4s = pickBestMp4s(mp4Urls);
      if (bestMp4s.length > 0) {
        // media_type === 'video' 단건: 첫 mediaUrl(커버 프레임) 을 mp4 로 교체
        // media_type === 'carousel': 이미지 URL 은 그대로, mp4 URL 을 앞쪽에 삽입
        if (rawMediaType === 'video') {
          if (result.mediaUrls.length > 0) {
            result.mediaUrls[0] = bestMp4s[0]!;
            result.mediaTypes[0] = 'video';
          } else {
            result.mediaUrls.push(bestMp4s[0]!);
            result.mediaTypes.push('video');
          }
        } else {
          // carousel: 커버 프레임 마커 있는 슬롯을 mp4 로 교체
          // 마커 없으면 첫 슬롯이 비디오 커버 프레임일 가능성이 높음 (Threads 는 대체로 비디오를 앞에 배치)
          // 따라서 슬롯 0을 mp4로 교체 (unshift 아님 · 총 개수 유지)
          let replaced = 0;
          for (let i = 0; i < result.mediaUrls.length && replaced < bestMp4s.length; i++) {
            if (result.mediaUrls[i]?.includes('video_default_cover_frame')) {
              result.mediaUrls[i] = bestMp4s[replaced]!;
              result.mediaTypes[i] = 'video';
              replaced += 1;
            }
          }
          if (replaced === 0 && result.mediaUrls.length > 0) {
            // 마커 매칭 실패 → 슬롯 0을 mp4로 교체 (heuristic)
            result.mediaUrls[0] = bestMp4s[0]!;
            result.mediaTypes[0] = 'video';
            replaced = 1;
          }
          logger.info(
            { url, rawMediaType, replaced, totalMp4: bestMp4s.length },
            'threads carousel · mp4 URL merged into mediaUrls',
          );
        }
      } else {
        logger.warn({ url, rawMediaType }, 'Playwright found no mp4 URL (게시글 실제 image-only)');
      }
    } catch (err) {
      logger.warn({ err, url }, 'Playwright video extract failed');
    }
  }

  logger.info(
    {
      url,
      author: result.authorHandle,
      textLen: result.text.length,
      mediaCount: result.mediaUrls.length,
      method: 'apify',
    },
    'threads adapter extraction complete',
  );

  return result;
}

async function fetchViaOg(url: string, parsed: ParsedUrl): Promise<ThreadsAdapterResult> {
  const res = await request(url, {
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  if (res.statusCode >= 400) {
    throw new ThreadsFetchError(`Threads fetch failed: HTTP ${res.statusCode}`, res.statusCode);
  }

  const html = await res.body.text();
  const ogDescription = matchMeta(html, 'og:description') ?? matchMeta(html, 'twitter:description');
  const ogImage = matchMeta(html, 'og:image') ?? matchMeta(html, 'twitter:image');

  let text = ogDescription ?? '';
  const bodyPatternMatch = /^@[^:]+:\s*"?(.*?)"?$/s.exec(text);
  if (bodyPatternMatch && bodyPatternMatch[1]) {
    text = bodyPatternMatch[1].trim();
  }

  const mediaUrls = ogImage ? [ogImage] : [];

  const result: ThreadsAdapterResult = {
    authorHandle: parsed.authorHandle,
    threadsPostId: parsed.postShortcode,
    permalink: url,
    text,
    mediaUrls,
    mediaTypes: mediaUrls.map(() => 'image' as MediaKind), // OG 는 image 만 반환
    publishedAt: null,
    language: detectLanguage(text),
    engagement: {},
    raw: { ogDescription, ogImage },
    fetchMethod: 'og-fallback',
  };

  logger.info(
    {
      url,
      author: result.authorHandle,
      textLen: result.text.length,
      mediaCount: result.mediaUrls.length,
      method: 'og-fallback',
    },
    'threads adapter extraction complete (OG fallback)',
  );

  return result;
}

interface ParsedUrl {
  authorHandle: string | null;
  postShortcode: string | null;
}

/**
 * Threads /share/ 단축 URL → 실제 게시글 URL 해석 (리다이렉트 추적).
 * 실패 시 null.
 */
async function resolveShareUrl(shareUrl: string): Promise<string | null> {
  // Threads /share/ 는 JS 클라이언트 렌더 → fetch 리다이렉트 안 됨. Playwright 로 최종 URL 확인.
  try {
    const { resolveThreadsShareUrl } = await import('../../../../infra/playwright-threads-video.js');
    return await resolveThreadsShareUrl(shareUrl);
  } catch (err) {
    logger.warn({ err, shareUrl }, 'share URL 해석 실패');
    return null;
  }
}

function parseThreadsUrl(url: string): ParsedUrl | null {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const handleMatch = /^\/@([^/]+)\/post\/([^/?#]+)/i.exec(path);
    if (handleMatch) {
      return { authorHandle: handleMatch[1] ?? null, postShortcode: handleMatch[2] ?? null };
    }
    const shortMatch = /^\/(?:t|post)\/([^/?#]+)/i.exec(path);
    if (shortMatch) {
      return { authorHandle: null, postShortcode: shortMatch[1] ?? null };
    }
    return null;
  } catch {
    return null;
  }
}

function matchMeta(html: string, name: string): string | null {
  const propRegex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegex(name)}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const contentFirstRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegex(name)}["']`,
    'i',
  );
  const raw = propRegex.exec(html)?.[1] ?? contentFirstRegex.exec(html)?.[1] ?? null;
  return raw ? decodeHtmlEntities(raw) : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function detectLanguage(text: string): string | null {
  if (!text) return null;
  const hangul = (text.match(/[가-힯]/g) ?? []).length;
  const hiraganaKatakana = (text.match(/[぀-ヿ]/g) ?? []).length;
  const cjkUnified = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;

  const scores: Array<[string, number]> = [
    ['ko', hangul],
    ['ja', hiraganaKatakana + cjkUnified * 0.3],
    ['zh', cjkUnified],
    ['en', latin],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const top = scores[0];
  if (!top || top[1] < 3) return null;
  return top[0];
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return undefined;
}
