import { env } from '../../../../config/env.js';
import { logger } from '../../../../config/logger.js';
import { runActorSync, isApifyConfigured, ApifyNotConfiguredError } from '../../../../infra/apify-client.js';

/**
 * 샤오홍슈(RED) URL 어댑터 — Apify 백엔드 사용.
 *
 * 공식 API 없고 봇 감지 강해서 Apify 액터 필수.
 * .env: APIFY_API_TOKEN + APIFY_ACTOR_XHS_URL 필요.
 *
 * 액터 후보 (사용자님이 Apify Store에서 선택):
 *   - zen-studio/rednote-comments-scraper (인기)
 *   - 기타 xiaohongshu/rednote/xhs 검색 결과
 *
 * 액터마다 input shape · output field 이름이 다를 수 있음.
 * 우리 코드는 공통 필드 이름을 여러 후보로 시도.
 */

export interface XhsAdapterInput {
  url: string;
}

export interface XhsAdapterResult {
  authorHandle: string | null;
  noteId: string | null;
  permalink: string;
  text: string;
  mediaUrls: string[];
  publishedAt: Date | null;
  language: string | null;
  engagement: {
    likes?: number;
    comments?: number;
    collects?: number;
    shares?: number;
  };
  raw: Record<string, unknown>;
}

export class XhsFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XhsFetchError';
  }
}

// 단축링크: xhslink.com/xxx (앱 공유 시 나오는 형태)
export async function fetchXhsPost(input: XhsAdapterInput): Promise<XhsAdapterResult> {
  if (!isApifyConfigured()) throw new ApifyNotConfiguredError();
  if (!env.APIFY_ACTOR_XHS_URL) {
    throw new XhsFetchError(
      'APIFY_ACTOR_XHS_URL 미설정. Apify Store에서 샤오홍슈(rednote/xhs) 액터를 골라 .env에 입력하세요.',
    );
  }

  // 액터별 input shape이 다름. 흔한 필드 이름 모두 넣어봄.
  // 예: postUrls, urls, startUrls, noteUrls
  const items = await runActorSync<Record<string, unknown>>({
    actorId: env.APIFY_ACTOR_XHS_URL,
    input: {
      startUrls: [{ url: input.url }],
      postUrls: [input.url],
      urls: [input.url],
      maxItems: 1,
    },
    timeoutSecs: 180,
  });

  if (!items.length) {
    throw new XhsFetchError(`Apify 액터가 결과 반환 안 함 (URL: ${input.url})`);
  }

  const item = items[0] as Record<string, unknown>;
  const result = normalizeXhsItem(item, input.url);
  logger.info(
    {
      author: result.authorHandle,
      textLen: result.text.length,
      mediaCount: result.mediaUrls.length,
      likes: result.engagement.likes,
    },
    'xhs adapter extraction complete',
  );
  return result;
}

/**
 * 액터별 다양한 필드명을 공통 shape으로 매핑.
 * 필드 이름 후보를 순차 시도.
 */
function normalizeXhsItem(item: Record<string, unknown>, url: string): XhsAdapterResult {
  const pick = <T = string>(...names: string[]): T | undefined => {
    for (const n of names) {
      const v = item[n];
      if (v !== undefined && v !== null && v !== '') return v as T;
    }
    return undefined;
  };

  const text =
    (pick<string>('desc', 'description', 'content', 'text', 'title', 'caption') as string) ?? '';

  const authorHandle =
    (pick<string>('authorHandle', 'author', 'authorNickname', 'userNickname', 'username', 'nickName') as string) ??
    null;

  const noteId =
    (pick<string>('noteId', 'id', 'postId', 'itemId', 'noteID') as string) ?? null;

  const publishedRaw = pick<unknown>('publishedAt', 'publishTime', 'time', 'createdAt', 'timestamp');
  const publishedAt = parseDate(publishedRaw);

  // 미디어: 여러 형태 지원
  const mediaUrls: string[] = [];
  const imagesRaw = pick<unknown>('images', 'imageUrls', 'imageList', 'media', 'mediaList');
  if (Array.isArray(imagesRaw)) {
    for (const m of imagesRaw) {
      if (typeof m === 'string') mediaUrls.push(m);
      else if (m && typeof m === 'object') {
        const asObj = m as Record<string, unknown>;
        const u = (asObj.url ?? asObj.src ?? asObj.imageUrl) as string | undefined;
        if (u) mediaUrls.push(u);
      }
    }
  }
  const cover = pick<string>('coverUrl', 'thumbnailUrl', 'cover', 'image');
  if (cover && !mediaUrls.includes(cover)) mediaUrls.unshift(cover);

  const engagement = {
    likes: toNum(pick<unknown>('likes', 'likeCount', 'likedCount', 'diggCount')),
    comments: toNum(pick<unknown>('comments', 'commentCount', 'commentsCount')),
    collects: toNum(pick<unknown>('collects', 'collectCount', 'collectedCount', 'favoriteCount')),
    shares: toNum(pick<unknown>('shares', 'shareCount', 'sharedCount')),
  };

  return {
    authorHandle,
    noteId,
    permalink: (pick<string>('url', 'permalink', 'noteUrl') as string) ?? url,
    text,
    mediaUrls,
    publishedAt,
    language: 'zh',
    engagement,
    raw: item,
  };
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
