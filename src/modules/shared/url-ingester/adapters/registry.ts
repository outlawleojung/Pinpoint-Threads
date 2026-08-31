import { InboundPlatform } from '@prisma/client';
import { fetchThreadsPost, type ThreadsAdapterResult } from './threads-adapter.js';
import { fetchTikTokPost, type TikTokAdapterResult } from './tiktok-adapter.js';
import { fetchInstagramPost, type InstagramAdapterResult } from './instagram-adapter.js';
import { fetchXhsPost, type XhsAdapterResult } from './xiaohongshu-adapter.js';

/**
 * Adapter Registry — 플랫폼별 fetch 로직 디스패치.
 *
 * 각 어댑터는 공통 AdapterResult 형태로 반환.
 * 어댑터 미구현 플랫폼은 null → 상위에서 상태를 FAILED로 저장.
 */

export interface AdapterResult {
  authorHandle: string | null;
  externalPostId: string | null;
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
  raw?: Record<string, unknown>;
}

export type Adapter = (input: { url: string }) => Promise<AdapterResult>;

const threadsAdapter: Adapter = async ({ url }) => {
  const r: ThreadsAdapterResult = await fetchThreadsPost({ url });
  return {
    authorHandle: r.authorHandle,
    externalPostId: r.threadsPostId,
    permalink: r.permalink,
    text: r.text,
    mediaUrls: r.mediaUrls,
    publishedAt: r.publishedAt,
    language: r.language,
    engagement: r.engagement,
    raw: r.raw,
  };
};

const tiktokAdapter: Adapter = async ({ url }) => {
  const r: TikTokAdapterResult = await fetchTikTokPost({ url });
  return {
    authorHandle: r.authorHandle,
    externalPostId: r.videoId,
    permalink: r.permalink,
    text: r.text,
    mediaUrls: r.mediaUrls,
    publishedAt: r.publishedAt,
    language: r.language,
    engagement: r.engagement,
    raw: r.raw,
  };
};

const instagramAdapter: Adapter = async ({ url }) => {
  const r: InstagramAdapterResult = await fetchInstagramPost({ url });
  return {
    authorHandle: r.authorHandle,
    externalPostId: r.shortcode,
    permalink: r.permalink,
    text: r.text,
    mediaUrls: r.mediaUrls,
    publishedAt: r.publishedAt,
    language: r.language,
    engagement: r.engagement,
    raw: r.raw,
  };
};

const xhsAdapter: Adapter = async ({ url }) => {
  const r: XhsAdapterResult = await fetchXhsPost({ url });
  return {
    authorHandle: r.authorHandle,
    externalPostId: r.noteId,
    permalink: r.permalink,
    text: r.text,
    mediaUrls: r.mediaUrls,
    publishedAt: r.publishedAt,
    language: r.language,
    engagement: r.engagement,
    raw: r.raw,
  };
};

const registry: Partial<Record<InboundPlatform, Adapter>> = {
  [InboundPlatform.THREADS]: threadsAdapter,
  [InboundPlatform.TIKTOK]: tiktokAdapter,
  [InboundPlatform.INSTAGRAM]: instagramAdapter,
  [InboundPlatform.XIAOHONGSHU]: xhsAdapter,
};

export function getAdapter(platform: InboundPlatform): Adapter | null {
  return registry[platform] ?? null;
}
