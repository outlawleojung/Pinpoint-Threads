import { request } from 'undici';
import { logger } from '../../../../config/logger.js';

/**
 * Threads URL Adapter — 게시글 단건 fetch.
 *
 * 전략:
 *   1) HTML 페이지 조회 (일반 브라우저 User-Agent)
 *   2) Open Graph 메타 태그 파싱 → text · image · author
 *   3) JSON-LD 스크립트 · Next.js __NEXT_DATA__ 있으면 상세 필드 추가 시도
 *   4) 실패 시 명확한 에러 (상위에서 Apify fallback 판단)
 */

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
  raw: {
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
  };
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

export async function fetchThreadsPost(input: ThreadsAdapterInput): Promise<ThreadsAdapterResult> {
  const url = input.url;
  const parsed = parseThreadsUrl(url);
  if (!parsed) {
    throw new ThreadsFetchError(`Not a recognized Threads post URL: ${url}`);
  }

  const res = await request(url, {
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      'accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
    },
  });

  if (res.statusCode >= 400) {
    throw new ThreadsFetchError(
      `Threads fetch failed: HTTP ${res.statusCode}`,
      res.statusCode,
    );
  }

  const html = await res.body.text();
  return extractFromHtml(html, url, parsed);
}

interface ParsedUrl {
  authorHandle: string | null;
  postShortcode: string | null;
}

function parseThreadsUrl(url: string): ParsedUrl | null {
  try {
    const u = new URL(url);
    // 지원 경로: /@handle/post/{shortcode}, /t/{shortcode}, /post/{shortcode}
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

function extractFromHtml(html: string, url: string, parsed: ParsedUrl): ThreadsAdapterResult {
  const ogTitle = matchMeta(html, 'og:title') ?? matchMeta(html, 'twitter:title');
  const ogDescription =
    matchMeta(html, 'og:description') ?? matchMeta(html, 'twitter:description');
  const ogImage = matchMeta(html, 'og:image') ?? matchMeta(html, 'twitter:image');
  const ogUrl = matchMeta(html, 'og:url') ?? url;

  // Threads OG description은 "@handle: 본문내용..." 패턴이 흔함
  let text = ogDescription ?? '';
  const bodyPatternMatch = /^@[^:]+:\s*"?(.*?)"?$/s.exec(text);
  if (bodyPatternMatch && bodyPatternMatch[1]) {
    text = bodyPatternMatch[1].trim();
  }

  const mediaUrls: string[] = [];
  if (ogImage) mediaUrls.push(ogImage);

  const language = detectLanguage(text);

  const result: ThreadsAdapterResult = {
    authorHandle: parsed.authorHandle,
    threadsPostId: parsed.postShortcode,
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
    'threads adapter extraction complete',
  );

  return result;
}

function matchMeta(html: string, name: string): string | null {
  // <meta property="og:title" content="..."> 또는 <meta name="twitter:title" content="...">
  const propRegex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegex(name)}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const contentFirstRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegex(name)}["']`,
    'i',
  );
  return (propRegex.exec(html)?.[1] ?? contentFirstRegex.exec(html)?.[1] ?? null)
    ? decodeHtmlEntities(propRegex.exec(html)?.[1] ?? contentFirstRegex.exec(html)?.[1] ?? '')
    : null;
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

/**
 * 언어 감지 (경량): 한/중/일/영 판별. 정밀도 낮지만 파이프라인 분기용으론 충분.
 * 정확한 감지는 이후 Claude 호출 시 위임.
 */
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
