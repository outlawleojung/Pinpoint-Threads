import { request } from 'undici';
import { logger } from '../../../../config/logger.js';
import { env } from '../../../../config/env.js';
import { runActorSync, isApifyConfigured } from '../../../../infra/apify-client.js';

export interface ThreadsAdapterInput {
  url: string;
}

export interface ThreadsAdapterResult {
  authorHandle: string | null;
  threadsPostId: string | null;
  permalink: string;
  text: string;
  mediaUrls: string[];
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
  const parsed = parseThreadsUrl(input.url);
  if (!parsed) {
    throw new ThreadsFetchError(`Not a recognized Threads post URL: ${input.url}`);
  }

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
      startUrls: [{ url }],
      urls: [url],
      directUrls: [url],
      maxItems: 1,
    },
    timeoutSecs: 120,
  });

  if (!items.length) {
    throw new ThreadsFetchError(`Apify actor returned 0 items for ${url}`);
  }

  const item = items[0] as Record<string, unknown>;
  return normalizeApifyItem(item, url, parsed);
}

function normalizeApifyItem(
  item: Record<string, unknown>,
  url: string,
  parsed: ParsedUrl,
): ThreadsAdapterResult {
  const pick = <T = string>(...names: string[]): T | undefined => {
    for (const n of names) {
      const v = item[n];
      if (v !== undefined && v !== null && v !== '') return v as T;
    }
    return undefined;
  };

  const text = (pick<string>('text', 'caption', 'content', 'description', 'postText') as string) ?? '';
  const authorHandle =
    (pick<string>('username', 'authorHandle', 'author', 'ownerUsername') as string) ??
    parsed.authorHandle;

  const mediaUrls: string[] = [];
  const imagesRaw = pick<unknown>('images', 'imageUrls', 'mediaUrls', 'media', 'carouselMedia');
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

  const videoUrl = pick<string>('videoUrl', 'video');
  if (videoUrl && !mediaUrls.includes(videoUrl)) mediaUrls.push(videoUrl);

  const publishedRaw = pick<unknown>('publishedAt', 'timestamp', 'takenAt', 'createdAt', 'date');
  const publishedAt = parseDate(publishedRaw);

  const engagement = {
    likes: toNum(pick<unknown>('likes', 'likeCount', 'likesCount')),
    replies: toNum(pick<unknown>('replies', 'replyCount', 'repliesCount', 'commentsCount')),
    reposts: toNum(pick<unknown>('reposts', 'repostCount', 'repostsCount', 'sharesCount')),
    quotes: toNum(pick<unknown>('quotes', 'quoteCount')),
  };

  const result: ThreadsAdapterResult = {
    authorHandle,
    threadsPostId: (pick<string>('id', 'postId', 'shortcode') as string) ?? parsed.postShortcode,
    permalink: (pick<string>('url', 'permalink') as string) ?? url,
    text,
    mediaUrls,
    publishedAt,
    language: detectLanguage(text),
    engagement,
    raw: item,
    fetchMethod: 'apify',
  };

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
