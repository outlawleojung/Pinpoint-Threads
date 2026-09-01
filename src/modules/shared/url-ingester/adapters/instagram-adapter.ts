import { request } from 'undici';
import { logger } from '../../../../config/logger.js';
import { env } from '../../../../config/env.js';
import { runActorSync, isApifyConfigured } from '../../../../infra/apify-client.js';

export interface InstagramAdapterInput {
  url: string;
}

export interface InstagramAdapterResult {
  authorHandle: string | null;
  shortcode: string | null;
  permalink: string;
  text: string;
  mediaUrls: string[];
  publishedAt: Date | null;
  language: string | null;
  engagement: {
    likes?: number;
    comments?: number;
  };
  raw: Record<string, unknown>;
  fetchMethod: 'apify' | 'og-fallback';
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export class InstagramFetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'InstagramFetchError';
  }
}

/**
 * Instagram 게시글 fetch — Apify 우선, OG fallback.
 *
 * Meta는 비로그인 서버 요청에 빈 OG 태그를 반환하므로 OG 파싱은 거의 항상 빈 결과.
 * Apify actor (예: apify/instagram-post-scraper) 가 설정되어 있으면 그것을 사용.
 */
export async function fetchInstagramPost(
  input: InstagramAdapterInput,
): Promise<InstagramAdapterResult> {
  const parsed = parseInstagramUrl(input.url);
  if (!parsed) {
    throw new InstagramFetchError(`Not a recognized Instagram post URL: ${input.url}`);
  }

  if (isApifyConfigured() && env.APIFY_ACTOR_IG_URL) {
    try {
      return await fetchViaApify(input.url, parsed);
    } catch (err) {
      logger.warn({ err, url: input.url }, 'instagram apify fetch failed, falling back to OG');
    }
  }

  return fetchViaOg(input.url, parsed);
}

async function fetchViaApify(url: string, parsed: ParsedUrl): Promise<InstagramAdapterResult> {
  const items = await runActorSync<Record<string, unknown>>({
    actorId: env.APIFY_ACTOR_IG_URL!,
    input: {
      username: [url],
      resultsLimit: 1,
      skipPinnedPosts: false,
      dataDetailLevel: 'detailedData',
    },
    timeoutSecs: 180,
  });

  const postItems = items.filter(
    (it) => (it as Record<string, unknown>)._type !== 'info',
  );
  if (!postItems.length) {
    throw new InstagramFetchError(`Apify actor returned 0 post items for ${url}`);
  }

  const item = postItems[0] as Record<string, unknown>;
  return normalizeApifyItem(item, url, parsed);
}

function normalizeApifyItem(
  item: Record<string, unknown>,
  url: string,
  parsed: ParsedUrl,
): InstagramAdapterResult {
  const pick = <T = string>(...names: string[]): T | undefined => {
    for (const n of names) {
      const v = item[n];
      if (v !== undefined && v !== null && v !== '') return v as T;
    }
    return undefined;
  };

  const text = (pick<string>('caption', 'text', 'description', 'content') as string) ?? '';
  const authorHandle =
    (pick<string>('ownerUsername', 'username', 'authorHandle', 'author') as string) ?? null;

  const mediaUrls: string[] = [];
  const imagesRaw = pick<unknown>('images', 'displayUrls', 'mediaUrls', 'sidecarImages', 'carouselMedia');
  if (Array.isArray(imagesRaw)) {
    for (const m of imagesRaw) {
      if (typeof m === 'string') mediaUrls.push(m);
      else if (m && typeof m === 'object') {
        const asObj = m as Record<string, unknown>;
        const u = (asObj.url ?? asObj.src ?? asObj.displayUrl) as string | undefined;
        if (u) mediaUrls.push(u);
      }
    }
  }
  const singleImage = pick<string>('displayUrl', 'imageUrl', 'thumbnailUrl', 'image');
  if (singleImage && !mediaUrls.includes(singleImage)) mediaUrls.unshift(singleImage);

  const videoUrl = pick<string>('videoUrl', 'video');
  if (videoUrl && !mediaUrls.includes(videoUrl)) mediaUrls.push(videoUrl);

  const publishedRaw = pick<unknown>('timestamp', 'takenAt', 'publishedAt', 'date');
  const publishedAt = parseDate(publishedRaw);

  const engagement = {
    likes: toNum(pick<unknown>('likesCount', 'likes', 'likeCount')),
    comments: toNum(pick<unknown>('commentsCount', 'comments', 'commentCount')),
  };

  const result: InstagramAdapterResult = {
    authorHandle,
    shortcode: (pick<string>('shortCode', 'shortcode', 'id') as string) ?? parsed.shortcode,
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
    'instagram adapter extraction complete',
  );

  return result;
}

async function fetchViaOg(url: string, parsed: ParsedUrl): Promise<InstagramAdapterResult> {
  const res = await request(url, {
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  if (res.statusCode >= 400) {
    throw new InstagramFetchError(
      `Instagram fetch failed: HTTP ${res.statusCode}`,
      res.statusCode,
    );
  }

  const html = await res.body.text();
  const ogTitle = matchMeta(html, 'og:title');
  const ogDescription = matchMeta(html, 'og:description');
  const ogImage = matchMeta(html, 'og:image');
  const ogUrl = matchMeta(html, 'og:url') ?? url;

  const authorHandle = extractAuthor(ogTitle, ogDescription);
  const text = extractCaption(ogDescription);
  const mediaUrls = ogImage ? [ogImage] : [];
  const engagement = extractEngagement(ogDescription);

  const result: InstagramAdapterResult = {
    authorHandle,
    shortcode: parsed.shortcode,
    permalink: ogUrl,
    text,
    mediaUrls,
    publishedAt: null,
    language: detectLanguage(text),
    engagement,
    raw: { ogTitle, ogDescription, ogImage },
    fetchMethod: 'og-fallback',
  };

  logger.info(
    {
      url,
      author: result.authorHandle,
      textLen: result.text.length,
      method: 'og-fallback',
    },
    'instagram adapter extraction complete (OG fallback)',
  );

  return result;
}

interface ParsedUrl {
  shortcode: string | null;
  kind: 'post' | 'reel' | 'tv' | null;
}

function parseInstagramUrl(url: string): ParsedUrl | null {
  try {
    const u = new URL(url);
    const m = /^\/(p|reel|tv)\/([^/?#]+)/i.exec(u.pathname);
    if (!m) return null;
    return { kind: m[1] as ParsedUrl['kind'], shortcode: m[2] ?? null };
  } catch {
    return null;
  }
}

function extractEngagement(ogDescription: string | null): { likes?: number; comments?: number } {
  if (!ogDescription) return {};
  const out: { likes?: number; comments?: number } = {};

  const parseNumWithSuffix = (n: string): number => {
    const clean = n.replace(/,/g, '').trim();
    const m = /^([\d.]+)([KMB]?)$/i.exec(clean);
    if (!m) return NaN;
    const num = parseFloat(m[1] ?? '0');
    const unit = (m[2] ?? '').toUpperCase();
    if (unit === 'K') return Math.round(num * 1_000);
    if (unit === 'M') return Math.round(num * 1_000_000);
    if (unit === 'B') return Math.round(num * 1_000_000_000);
    return Math.round(num);
  };

  const likesEn = /([\d.,]+[KMB]?)\s*likes?/i.exec(ogDescription);
  if (likesEn?.[1]) {
    const n = parseNumWithSuffix(likesEn[1]);
    if (!isNaN(n)) out.likes = n;
  }
  const commentsEn = /([\d.,]+[KMB]?)\s*comments?/i.exec(ogDescription);
  if (commentsEn?.[1]) {
    const n = parseNumWithSuffix(commentsEn[1]);
    if (!isNaN(n)) out.comments = n;
  }

  return out;
}

function extractAuthor(ogTitle: string | null, ogDescription: string | null): string | null {
  if (ogTitle) {
    const m = /^@?([^\s]+)\s+on\s+Instagram/i.exec(ogTitle);
    if (m) return m[1] ?? null;
  }
  if (ogDescription) {
    const m = /-\s*@?([\w.]+)\s+on/i.exec(ogDescription);
    if (m) return m[1] ?? null;
  }
  return null;
}

function extractCaption(ogDescription: string | null): string {
  if (!ogDescription) return '';
  const m = /:\s*"?(.*?)"?\.?\s*$/s.exec(ogDescription);
  if (m && m[1]) return m[1].trim();
  return ogDescription.trim();
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
