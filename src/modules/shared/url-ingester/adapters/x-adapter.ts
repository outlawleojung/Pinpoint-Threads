import { request } from 'undici';
import { logger } from '../../../../config/logger.js';

/**
 * X(트위터) 어댑터 — 임베드용 공개 syndication 엔드포인트 사용.
 *
 * `cdn.syndication.twimg.com/tweet-result` 는 트위터가 임베드 위젯에 쓰는 공개(비로그인) JSON API.
 * 텍스트·이미지·mp4 variant·저자·시각을 한 번에 반환한다. Playwright/Apify 불필요 → 비용·안정성 우위.
 *
 * ⚠️ 비공식이라 스키마가 조용히 바뀔 수 있음 → 방어적으로 여러 경로에서 값을 집는다.
 */

export interface XAdapterResult {
  authorHandle: string | null;
  tweetId: string | null;
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
    views?: number;
  };
  raw: Record<string, unknown>;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export class XFetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'XFetchError';
  }
}

/** x.com / twitter.com URL 에서 트윗 ID 추출. */
export function parseTweetId(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const m = /\/status(?:es)?\/(\d+)/.exec(u.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * syndication 엔드포인트가 요구하는 token 파생값.
 * 알려진 공식: ((id / 1e15) * PI).toString(36) 에서 0·소수점 제거.
 */
function deriveToken(id: string): string {
  const n = (Number(id) / 1e15) * Math.PI;
  return n.toString(36).replace(/(0+|\.)/g, '');
}

export async function fetchXPost(input: { url: string }): Promise<XAdapterResult> {
  const tweetId = parseTweetId(input.url);
  if (!tweetId) {
    throw new XFetchError(`Not a recognized X/Twitter status URL: ${input.url}`);
  }
  const token = deriveToken(tweetId);
  const endpoint =
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}` +
    `&lang=en&token=${token}` +
    `&features=tfw_timeline_list%3A%3B` +
    `&fields=article_results%2Ccomponent_objects` ;

  const res = await request(endpoint, {
    method: 'GET',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json',
      'accept-language': 'en-US,en;q=0.9,ja;q=0.8,ko;q=0.7',
    },
  });

  if (res.statusCode >= 400) {
    throw new XFetchError(`X syndication fetch failed: HTTP ${res.statusCode}`, res.statusCode);
  }

  const json = (await res.body.json()) as Record<string, any>;
  if (!json || (json.__typename && json.__typename === 'TweetTombstone')) {
    throw new XFetchError(`X tweet unavailable (deleted/protected): ${tweetId}`);
  }

  const text: string =
    typeof json.text === 'string' ? json.text
    : typeof json.full_text === 'string' ? json.full_text
    : '';

  const user = (json.user ?? {}) as Record<string, any>;
  const authorHandle: string | null =
    (user.screen_name as string) ?? (json.user_screen_name as string) ?? null;

  const mediaUrls = extractMedia(json);

  const publishedAt = json.created_at ? new Date(String(json.created_at)) : null;

  const result: XAdapterResult = {
    authorHandle,
    tweetId,
    permalink: authorHandle
      ? `https://x.com/${authorHandle}/status/${tweetId}`
      : `https://x.com/i/status/${tweetId}`,
    text: stripTrailingTco(text),
    mediaUrls,
    publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
    language: typeof json.lang === 'string' ? json.lang : detectLanguage(text),
    engagement: {
      likes: toNum(json.favorite_count),
      replies: toNum(json.conversation_count ?? json.reply_count),
      reposts: toNum(json.retweet_count),
      quotes: toNum(json.quote_count),
      views: toNum(json.view_count ?? json?.views?.count),
    },
    raw: json,
  };

  logger.info(
    { url: input.url, tweetId, author: authorHandle, textLen: result.text.length, mediaCount: mediaUrls.length },
    'X syndication extraction complete',
  );
  return result;
}

/**
 * mediaDetails(신) / photos·video(구) 양쪽에서 미디어 URL 수집.
 * 비디오는 최고 비트레이트 mp4 하나를 앞으로, 나머지 이미지 뒤.
 */
function extractMedia(json: Record<string, any>): string[] {
  const videos: string[] = [];
  const images: string[] = [];

  const details = Array.isArray(json.mediaDetails) ? json.mediaDetails : [];
  for (const m of details) {
    const type = m?.type as string | undefined;
    if (type === 'video' || type === 'animated_gif') {
      const variants: any[] = m?.video_info?.variants ?? [];
      const best = pickBestMp4Variant(variants);
      if (best) videos.push(best);
      else if (m?.media_url_https) images.push(m.media_url_https); // poster fallback
    } else if (m?.media_url_https) {
      images.push(m.media_url_https as string);
    }
  }

  // 구 스키마 fallback
  if (videos.length === 0 && images.length === 0) {
    const photos: any[] = Array.isArray(json.photos) ? json.photos : [];
    for (const p of photos) if (p?.url) images.push(p.url as string);
    const vv: any[] = json?.video?.variants ?? [];
    const best = pickBestMp4Variant(vv);
    if (best) videos.push(best);
  }

  return [...new Set([...videos, ...images])];
}

function pickBestMp4Variant(variants: any[]): string | null {
  const mp4s = (variants ?? [])
    .filter((v) => (v?.type === 'video/mp4' || v?.content_type === 'video/mp4') && (v?.src ?? v?.url))
    .map((v) => ({ src: (v.src ?? v.url) as string, bitrate: toNum(v.bitrate) ?? 0 }));
  if (mp4s.length === 0) return null;
  mp4s.sort((a, b) => b.bitrate - a.bitrate);
  return mp4s[0]!.src;
}

/** 트윗 끝에 붙는 미디어 t.co 링크 제거(본문 카피 참고용으로 노이즈). */
function stripTrailingTco(text: string): string {
  return text.replace(/\s*https:\/\/t\.co\/\w+\s*$/g, '').trim();
}

function detectLanguage(text: string): string | null {
  if (!text) return null;
  const hangul = (text.match(/[가-힯]/g) ?? []).length;
  const kana = (text.match(/[぀-ヿ]/g) ?? []).length;
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const scores: Array<[string, number]> = [
    ['ko', hangul],
    ['ja', kana + cjk * 0.3],
    ['zh', cjk],
    ['en', latin],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const top = scores[0];
  if (!top || top[1] < 3) return null;
  return top[0];
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return undefined;
}
