import { request } from 'undici';
import { logger } from '../../../../config/logger.js';

/**
 * TikTok URL Adapter.
 *
 * 전략:
 *   1) 단축 URL(vm.tiktok.com, vt.tiktok.com) 이면 HEAD로 canonical 해석
 *   2) 공식 oEmbed 엔드포인트 조회 (인증 불필요, 무료, 공개)
 *      - 얻는 것: title(caption), author_name, thumbnail_url
 *      - 못 얻는 것: 좋아요·조회수·비디오 파일 URL (→ 필요 시 Apify fallback, 미구현)
 *   3) 부족한 정보(engagement)는 이후 Apify fallback 태스크에서 채움
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
  engagement: {};
  raw: {
    title: string | null;
    thumbnailUrl: string | null;
    authorUrl: string | null;
  };
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

  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonical)}`;
  const res = await request(oembedUrl, {
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json',
    },
  });

  if (res.statusCode >= 400) {
    throw new TikTokFetchError(
      `TikTok oEmbed failed: HTTP ${res.statusCode}`,
      res.statusCode,
    );
  }

  const json = (await res.body.json()) as any;
  const title: string = json.title ?? '';
  const authorName: string | undefined = json.author_name ?? undefined;
  const authorUrl: string | undefined = json.author_url ?? undefined;
  const thumbnailUrl: string | undefined = json.thumbnail_url ?? undefined;

  const mediaUrls = thumbnailUrl ? [thumbnailUrl] : [];
  const language = detectLanguage(title);

  const result: TikTokAdapterResult = {
    authorHandle: authorName ?? parsed.authorHandle,
    videoId: parsed.videoId,
    permalink: canonical,
    text: title,
    mediaUrls,
    publishedAt: null,
    language,
    engagement: {},
    raw: {
      title: title || null,
      thumbnailUrl: thumbnailUrl ?? null,
      authorUrl: authorUrl ?? null,
    },
  };

  logger.info(
    {
      url: input.url,
      canonical,
      author: result.authorHandle,
      textLen: result.text.length,
      mediaCount: result.mediaUrls.length,
      language,
    },
    'tiktok adapter extraction complete',
  );

  return result;
}

interface ParsedUrl {
  authorHandle: string | null;
  videoId: string | null;
}

function parseTikTokUrl(url: string): ParsedUrl | null {
  try {
    const u = new URL(url);
    // /@handle/video/12345
    const m = /^\/@([^/]+)\/video\/(\d+)/i.exec(u.pathname);
    if (m) return { authorHandle: m[1] ?? null, videoId: m[2] ?? null };
    // /video/12345 (계정 없이)
    const m2 = /^\/video\/(\d+)/i.exec(u.pathname);
    if (m2) return { authorHandle: null, videoId: m2[1] ?? null };
    return null;
  } catch {
    return null;
  }
}

/**
 * vm.tiktok.com / vt.tiktok.com 단축 URL을 실제 URL로 해석.
 * HEAD 요청 후 Location 헤더 추출. HEAD 미지원 시 GET fallback.
 */
async function resolveCanonicalUrl(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (!/(?:^|\.)v[mt]\.tiktok\.com$/i.test(u.hostname)) {
      return url;
    }
  } catch {
    return url;
  }

  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await request(url, {
        method,
        headers: { 'user-agent': USER_AGENT },
      });
      const location = res.headers['location'];
      if (typeof location === 'string' && location.startsWith('http')) {
        // trailing tracking param 정리
        const cleaned = location.split('?')[0] ?? location;
        return cleaned;
      }
      // 3xx가 아닌 200 응답이면 그대로 최종 URL
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return url;
      }
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
