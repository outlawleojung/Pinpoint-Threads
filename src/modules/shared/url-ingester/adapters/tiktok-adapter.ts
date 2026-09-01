import { request } from 'undici';
import { logger } from '../../../../config/logger.js';
import { env } from '../../../../config/env.js';
import { runActorSync, isApifyConfigured } from '../../../../infra/apify-client.js';

/**
 * TikTok URL Adapter.
 *
 * 전략 (Apify-first · oEmbed fallback):
 *   1) 단축 URL(vm.tiktok.com, vt.tiktok.com) 이면 HEAD로 canonical 해석
 *   2) Apify actor 있으면 실 데이터 (본문·좋아요·댓글·비디오 URL) 수집
 *   3) 없으면 공식 oEmbed 로 최소 정보 (title, thumbnail)
 */

export interface TikTokAdapterInput {
  url: string;
}

export interface TikTokAdapterResult {
  authorHandle: string | null;
  videoId: string | null;
  permalink: string;
  text: string;
  mediaUrls: string[];
  publishedAt: Date | null;
  language: string | null;
  engagement: {
    likes?: number;
    replies?: number;
    reposts?: number;
    views?: number;
  };
  raw: Record<string, unknown>;
  fetchMethod: 'apify' | 'oembed';
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export class TikTokFetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'TikTokFetchError';
  }
}

export async function fetchTikTokPost(input: TikTokAdapterInput): Promise<TikTokAdapterResult> {
  const canonical = await resolveCanonicalUrl(input.url);
  const parsed = parseTikTokUrl(canonical);
  if (!parsed) {
    throw new TikTokFetchError(`Not a recognized TikTok video URL: ${canonical}`);
  }

  if (isApifyConfigured() && env.APIFY_ACTOR_TIKTOK_URL) {
    try {
      return await fetchViaApify(canonical, parsed);
    } catch (err) {
      logger.warn({ err, url: canonical }, 'tiktok apify fetch failed, falling back to oEmbed');
    }
  }

  return fetchViaOembed(canonical, parsed);
}

async function fetchViaApify(url: string, parsed: ParsedUrl): Promise<TikTokAdapterResult> {
  const items = await runActorSync<Record<string, unknown>>({
    actorId: env.APIFY_ACTOR_TIKTOK_URL!,
    input: {
      postURLs: [url],
      resultsPerPage: 1,
      shouldDownloadCovers: false,
      shouldDownloadVideos: false,
      shouldDownloadSlideshowImages: false,
      scrapeRelatedVideos: false,
    },
    timeoutSecs: 180,
  });

  const postItems = items.filter((it) => (it as Record<string, unknown>)._type !== 'info');
  if (!postItems.length) {
    throw new TikTokFetchError(`Apify actor returned 0 items for ${url}`);
  }
  return normalizeApifyItem(postItems[0] as Record<string, unknown>, url, parsed);
}

function normalizeApifyItem(
  item: Record<string, unknown>,
  url: string,
  parsed: ParsedUrl,
): TikTokAdapterResult {
  const pick = <T = string>(...names: string[]): T | undefined => {
    for (const n of names) {
      const v = item[n];
      if (v !== undefined && v !== null && v !== '') return v as T;
    }
    return undefined;
  };

  const text = (pick<string>('text', 'desc', 'description', 'caption', 'title') as string) ?? '';

  // clockworks 액터: authorMeta = { name, nickname, ... }
  const authorMeta = item.authorMeta as Record<string, unknown> | undefined;
  const authorHandle =
    (authorMeta?.name as string | undefined) ??
    (pick<string>('authorName', 'author', 'username', 'author_name') as string | undefined) ??
    parsed.authorHandle;

  // videoMeta·covers·mediaUrls·videoUrl 등 여러 후보 시도
  const mediaUrls: string[] = [];
  const videoMeta = item.videoMeta as Record<string, unknown> | undefined;
  const cover = (videoMeta?.coverUrl ?? videoMeta?.originalCoverUrl) as string | undefined;
  if (cover) mediaUrls.push(cover);
  const singleThumb = pick<string>('coverUrl', 'thumbnail', 'thumbnailUrl');
  if (singleThumb && !mediaUrls.includes(singleThumb)) mediaUrls.push(singleThumb);
  const videoUrl = pick<string>('videoUrl', 'video_url', 'mediaUrl');
  if (videoUrl && !mediaUrls.includes(videoUrl)) mediaUrls.push(videoUrl);

  const engagement = {
    likes: toNum(pick<unknown>('diggCount', 'likes', 'likeCount')),
    replies: toNum(pick<unknown>('commentCount', 'comments', 'commentsCount')),
    reposts: toNum(pick<unknown>('shareCount', 'shares')),
    views: toNum(pick<unknown>('playCount', 'views', 'viewCount')),
  };

  const publishedRaw = pick<unknown>('createTimeISO', 'createTime', 'created_at', 'timestamp');
  const publishedAt = parseDate(publishedRaw);

  const result: TikTokAdapterResult = {
    authorHandle,
    videoId: (pick<string>('id', 'videoId') as string) ?? parsed.videoId,
    permalink: (pick<string>('webVideoUrl', 'url', 'permalink') as string) ?? url,
    text,
    mediaUrls,
    publishedAt,
    language: detectLanguage(text),
    engagement,
    raw: item,
    fetchMethod: 'apify',
  };

  logger.info(
    { url, author: result.authorHandle, textLen: result.text.length, mediaCount: result.mediaUrls.length, method: 'apify' },
    'tiktok adapter extraction complete',
  );
  return result;
}

async function fetchViaOembed(url: string, parsed: ParsedUrl): Promise<TikTokAdapterResult> {
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const res = await request(oembedUrl, {
    method: 'GET',
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (res.statusCode >= 400) {
    throw new TikTokFetchError(`TikTok oEmbed failed: HTTP ${res.statusCode}`, res.statusCode);
  }
  const json = (await res.body.json()) as any;
  const title: string = json.title ?? '';
  const authorName: string | undefined = json.author_name ?? undefined;
  const thumbnailUrl: string | undefined = json.thumbnail_url ?? undefined;

  return {
    authorHandle: authorName ?? parsed.authorHandle,
    videoId: parsed.videoId,
    permalink: url,
    text: title,
    mediaUrls: thumbnailUrl ? [thumbnailUrl] : [],
    publishedAt: null,
    language: detectLanguage(title),
    engagement: {},
    raw: { title, thumbnailUrl, authorUrl: json.author_url },
    fetchMethod: 'oembed',
  };
}

interface ParsedUrl {
  authorHandle: string | null;
  videoId: string | null;
}

function parseTikTokUrl(url: string): ParsedUrl | null {
  try {
    const u = new URL(url);
    const m = /^\/@([^/]+)\/video\/(\d+)/i.exec(u.pathname);
    if (m) return { authorHandle: m[1] ?? null, videoId: m[2] ?? null };
    const m2 = /^\/video\/(\d+)/i.exec(u.pathname);
    if (m2) return { authorHandle: null, videoId: m2[1] ?? null };
    return null;
  } catch {
    return null;
  }
}

async function resolveCanonicalUrl(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (!/(?:^|\.)v[mt]\.tiktok\.com$/i.test(u.hostname)) return url;
  } catch {
    return url;
  }
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await request(url, { method, headers: { 'user-agent': USER_AGENT } });
      const location = res.headers['location'];
      if (typeof location === 'string' && location.startsWith('http')) {
        return location.split('?')[0] ?? location;
      }
      if (res.statusCode >= 200 && res.statusCode < 300) return url;
    } catch (err) {
      logger.warn({ err, url, method }, 'canonical resolve attempt failed');
    }
  }
  return url;
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
