import { logger } from '../config/logger.js';
import { getBrowser } from './playwright-threads-video.js';

/**
 * Threads 공개 페이지(게시글·프로필·검색)를 **비로그인 익명 헤드리스**로 열어
 * 페이지에 내장된 Relay JSON 에서 게시글 객체를 파싱한다. **무료** (Apify 대체).
 *
 * 배경: Apify 무료 크레딧 소진(2026-09-21~) → URL 수집이 미디어 0개로 떨어져 발행량 급감.
 * 실측(2026-09-30): 비로그인으로 게시글·프로필·검색(`/search?q=`) 모두 like_count·video_versions·carousel 포함.
 *
 * 안전 원칙은 playwright-threads-video 와 동일: 로그인 X · 우리 계정 쿠키/토큰 X · 순차 실행.
 */

export type RelayMediaKind = 'image' | 'video';

export interface RelayPost {
  code: string;
  username: string | null;
  text: string;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  takenAt: Date | null;
  language: string | null;
  /** 1=사진 2=영상 8=캐러셀 19=텍스트 */
  mediaType: number;
  media: { url: string; kind: RelayMediaKind }[];
  /** 카드 미리보기용 이미지(영상이면 커버). */
  thumbnailUrl: string | null;
  permalink: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function bestImage(o: any): string | null {
  const c = o?.image_versions2?.candidates;
  if (!Array.isArray(c) || c.length === 0) return null;
  // 가장 큰 해상도
  const sorted = [...c].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  return sorted[0]?.url ?? null;
}

function bestVideo(o: any): string | null {
  const v = o?.video_versions;
  if (!Array.isArray(v) || v.length === 0) return null;
  const sorted = [...v].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  return sorted[0]?.url ?? null;
}

function mediaOf(o: any): { url: string; kind: RelayMediaKind }[] {
  const own = ownMedia(o);
  if (own.length > 0) return own;
  // 텍스트 글(media_type 19)이 다른 글의 영상/사진을 끼워 넣은 경우 — 그 미디어를 쓴다.
  const info = o?.text_post_app_info ?? {};
  // 끼워 넣은 영상 · 인용글 · 인용 첨부(quoted_attachment_post — 다른 사람 영상 글을 인용한 텍스트 글, 2026-10-01 실측)
  for (const inner of [info.linked_inline_media, info.share_info?.quoted_post, info.share_info?.quoted_attachment_post]) {
    if (inner && typeof inner === 'object') {
      const m = ownMedia(inner);
      if (m.length > 0) return m;
    }
  }
  return [];
}

function ownMedia(o: any): { url: string; kind: RelayMediaKind }[] {
  const items = Array.isArray(o?.carousel_media) && o.carousel_media.length > 0 ? o.carousel_media : [o];
  const out: { url: string; kind: RelayMediaKind }[] = [];
  for (const m of items) {
    const v = bestVideo(m);
    if (v) {
      out.push({ url: v, kind: 'video' });
      continue;
    }
    const i = bestImage(m);
    if (i) out.push({ url: i, kind: 'image' });
  }
  return out;
}

function thumbOf(o: any): string | null {
  const info = o?.text_post_app_info ?? {};
  for (const x of [o, o?.carousel_media?.[0], info.linked_inline_media, info.share_info?.quoted_post, info.share_info?.quoted_post?.carousel_media?.[0], info.share_info?.quoted_attachment_post]) {
    const i = x ? bestImage(x) : null;
    if (i) return i;
  }
  return null;
}

function toRelayPost(o: any): RelayPost {
  const username: string | null = o.user?.username ?? null;
  const info = o.text_post_app_info ?? {};
  return {
    code: o.code,
    username,
    text: o.caption?.text ?? '',
    likes: Number(o.like_count ?? 0),
    replies: Number(info.direct_reply_count ?? 0),
    reposts: Number(info.repost_count ?? 0),
    quotes: Number(info.quote_count ?? 0),
    takenAt: typeof o.taken_at === 'number' ? new Date(o.taken_at * 1000) : null,
    language: o.detected_language ?? null,
    mediaType: Number(o.media_type ?? 0),
    media: mediaOf(o),
    thumbnailUrl: thumbOf(o),
    permalink: `https://www.threads.com/@${username ?? '_'}/post/${o.code}`,
  };
}

/** JSON 트리에서 게시글 객체(code + like_count) 수집. 중복 code 제거(첫 등장 유지). */
function collectPosts(root: unknown, into: Map<string, RelayPost>): void {
  const walk = (o: any, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 80) return;
    if (typeof o.code === 'string' && 'like_count' in o && o.caption !== undefined) {
      if (!into.has(o.code)) into.set(o.code, toRelayPost(o));
      return;
    }
    for (const k in o) walk(o[k], depth + 1);
  };
  walk(root, 0);
}

export interface ScrapeOptions {
  /** 추가 로드를 위한 스크롤 횟수 (검색·프로필용, 기본 0) */
  scrolls?: number;
  locale?: string;
}

/**
 * Threads 공개 페이지 1개를 열어 게시글 목록 반환(페이지 등장 순서).
 * 게시글 페이지면 target 이 보통 맨 앞이지만, 호출자는 code 로 골라야 한다.
 */
export async function scrapeThreadsPage(url: string, opts: ScrapeOptions = {}): Promise<RelayPost[]> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: opts.locale ?? 'ko-KR' });
  const page = await context.newPage();
  const posts = new Map<string, RelayPost>();
  const pending: Promise<void>[] = [];
  page.on('response', (resp) => {
    if (!/\/graphql|\/api\/v1\//.test(resp.url())) return;
    pending.push(
      resp
        .text()
        .then((t) => {
          if (!t.includes('like_count')) return;
          for (const chunk of t.split('\n')) {
            try {
              collectPosts(JSON.parse(chunk.replace(/^for \(;;\);/, '')), posts);
            } catch {
              /* 비JSON 청크 무시 */
            }
          }
        })
        .catch(() => {}),
    );
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    for (let i = 0; i < (opts.scrolls ?? 0); i++) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 1500));
    }
    const scripts: string[] = await page.$$eval('script[type="application/json"]', (els) =>
      els.map((e) => e.textContent ?? ''),
    );
    for (const s of scripts) {
      if (!s.includes('like_count')) continue;
      try {
        collectPosts(JSON.parse(s), posts);
      } catch {
        /* ignore */
      }
    }
    // 스트리밍/롱폴 응답은 body 가 안 끝날 수 있음 → 최대 3초만 기다림 (무한 대기 방지)
    await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, 3000))]);
  } finally {
    await context.close().catch(() => {});
  }
  const out = Array.from(posts.values());
  logger.info({ url, posts: out.length }, 'threads relay scrape');
  return out;
}

/** 게시글 URL → 해당 게시글 1개 (shortcode 매칭). 없으면 null. */
export async function fetchThreadsPostRelay(url: string, shortcode: string): Promise<RelayPost | null> {
  const posts = await scrapeThreadsPage(url);
  return posts.find((p) => p.code === shortcode) ?? null;
}
