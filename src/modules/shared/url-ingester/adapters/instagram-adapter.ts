import { request } from 'undici';
import { logger } from '../../../../config/logger.js';

/**
 * Instagram URL Adapter.
 *
 * 지원 URL 형태:
 *   /p/{shortcode}/    (게시글)
 *   /reel/{shortcode}/ (릴스)
 *   /tv/{shortcode}/   (IGTV)
 *   instagr.am 단축링크
 *
 * 전략:
 *   - 게스트로 HTML 페이지 조회 + Open Graph 파싱 (공개 게시글만)
 *   - Instagram은 봇 감지 강함. 실패 시 Apify fallback (미구현)로 안내
 *
 * 획득: og:image · og:description · og:title (caption)
 * 미획득: 좋아요/댓글 수, 다중 미디어 (caroulsel), 저자 팔로워 수
 */

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
  engagement: {};
  raw: {
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
  };
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

export async function fetchInstagramPost(
  input: InstagramAdapterInput,
): Promise<InstagramAdapterResult> {
  const parsed = parseInstagramUrl(input.url);
  if (!parsed) {
    throw new InstagramFetchError(`Not a recognized Instagram post URL: ${input.url}`);
  }

  const res = await request(input.url, {
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  if (res.statusCode >= 400) {
    throw new InstagramFetchError(
      `Instagram fetch failed: HTTP ${res.statusCode}. 봇 감지 or 비공개 게시글일 수 있음. Apify 백엔드(Task #5b) 필요.`,
      res.statusCode,
    );
  }

  const html = await res.body.text();
  return extractFromHtml(html, input.url, parsed);
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

function extractFromHtml(
  html: string,
  url: string,
  _parsed: ParsedUrl,
): InstagramAdapterResult {
  const ogTitle = matchMeta(html, 'og:title');
  const ogDescription = matchMeta(html, 'og:description');
  const ogImage = matchMeta(html, 'og:image');
  const ogUrl = matchMeta(html, 'og:url') ?? url;

  // og:description 포맷: "3,234 likes, 45 comments - @handle on <date>: "본문"."
  // og:title 포맷: "@handle on Instagram: ..."
  const authorHandle = extractAuthor(ogTitle, ogDescription);
  const text = extractCaption(ogDescription);
  const mediaUrls = ogImage ? [ogImage] : [];
  const language = detectLanguage(text);

  const result: InstagramAdapterResult = {
    authorHandle,
    shortcode: _parsed.shortcode,
    permalink: ogUrl,
    text,
    mediaUrls,
    publishedAt: null,
    language,
    engagement: {},
    raw: {
      ogTitle,
      ogDescription,
      ogImage,
    },
  };

  logger.info(
    {
      url,
      author: result.authorHandle,
      textLen: result.text.length,
      mediaCount: result.mediaUrls.length,
      language,
    },
    'instagram adapter extraction complete',
  );

  return result;
}

function extractAuthor(ogTitle: string | null, ogDescription: string | null): string | null {
  // og:title 예: "@minyoung.jung on Instagram: "..."
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
  // 패턴: "1,234 likes, 45 comments - handle on 2026-01-01: "본문"."
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
