import { request } from 'undici';
import { logger } from '../../../../config/logger.js';
import { fetchXPost } from '../../url-ingester/adapters/x-adapter.js';
import { isAllowedText } from '../filters.js';
import type { DiscoveryAdapter, DiscoveryAdapterResult, DiscoveryCandidate } from '../types.js';
import { randomUUID } from 'node:crypto';

/**
 * 일본 X(트위터) 바이럴 **영상** 발굴 어댑터 (검증됨 · 주력).
 *
 * 전략: 일본 X 화제 트윗을 매일 정리하는 큐레이션 사이트(buzzweet)의 **일일 종합글**
 * (`/YYYYMMDD-tweet/`) 최근 며칠치 + 동물 모음글을 크롤 → 트윗 URL 수집 →
 * 트위터 syndication 으로 enrich → **영상(mp4)만** 남김(동물·움직임 콘텐츠는 정지 이미지로 부족 ·
 * 사용자 방침 2026-09-28) → 정치/슬픔 필터 → 좋아요 랭킹.
 *
 * 정서: 일본 종합 바이럴(동물·음식·웃긴 순간 등) = 한국인이 봐도 반응 나오는 감성.
 * → [project_source_foreign_viral_only]
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** 일일 종합글을 몇 일치 거슬러 볼지. */
const DAYS_BACK = 6;
/** syndication enrich 총 상한(비용·시간·레이트리밋 방어). */
const MAX_ENRICH_TOTAL = 55;

const STATUS_URL_RE = /https?:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d+)/g;

/** buzzweet 일일 종합글 URL 목록(오늘~N일 전, JST 기준) + 동물 모음글. */
function buildSourcePages(): string[] {
  const pages: string[] = [];
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // JST
  for (let i = 0; i < DAYS_BACK; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    pages.push(`https://buzzweet.com/${ymd}-tweet/`);
  }
  pages.push('https://buzzweet.com/animal-tweet/');
  return pages;
}

export class JpAnimalXAdapter implements DiscoveryAdapter {
  readonly name = 'jp-x-viral';

  async discover(limit: number): Promise<DiscoveryAdapterResult> {
    const pages = buildSourcePages();
    const seenIds = new Set<string>();
    const orderedIds: string[] = [];
    let anyPageOk = false;
    const errors: string[] = [];

    // 1) 소스 페이지들에서 트윗 ID 수집(등장 순 = 화제 순).
    for (const page of pages) {
      try {
        const res = await request(page, {
          method: 'GET',
          headers: { 'user-agent': USER_AGENT, accept: 'text/html', 'accept-language': 'ja,en;q=0.7' },
        });
        if (res.statusCode >= 400) {
          errors.push(`${page.replace('https://buzzweet.com', '')}:${res.statusCode}`);
          continue;
        }
        const html = await res.body.text();
        anyPageOk = true;
        for (const m of html.matchAll(STATUS_URL_RE)) {
          const id = m[1]!;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            orderedIds.push(id);
          }
        }
      } catch (err) {
        errors.push(`${page.replace('https://buzzweet.com', '')}:${(err as Error).message}`);
      }
    }

    // 2) enrich → 영상만 채택. 목표치(limit) 채우거나 상한 도달 시 중단.
    const candidates: DiscoveryCandidate[] = [];
    let enriched = 0;
    for (const id of orderedIds) {
      if (enriched >= MAX_ENRICH_TOTAL) break;
      if (candidates.length >= limit * 2) break;
      enriched += 1;
      try {
        const r = await fetchXPost({ url: `https://x.com/i/status/${id}` });
        const hasVideo = r.mediaUrls.some((u) => /\.mp4(?:\?|$)/i.test(u));
        if (!hasVideo) continue; // 영상만
        if (!isAllowedText(r.text)) continue;
        const md = (r.raw as { mediaDetails?: Array<{ media_url_https?: string }> }).mediaDetails;
        const poster = Array.isArray(md)
          ? md.map((m) => m.media_url_https).find((u): u is string => typeof u === 'string')
          : undefined;
        candidates.push({
          id: randomUUID().slice(0, 12),
          adapter: this.name,
          platform: 'x',
          sourceUrl: r.permalink,
          title: (r.text || '(무캡션 영상)').replace(/\s+/g, ' ').slice(0, 60),
          text: r.text,
          thumbnailUrl: poster,
          mediaCount: r.mediaUrls.length,
          hasVideo: true,
          authorHandle: r.authorHandle ?? undefined,
          lang: r.language ?? undefined,
          kindHint: 'daily',
          score: r.engagement.likes ?? 0,
          foundAt: new Date().toISOString(),
        });
      } catch (err) {
        logger.debug({ err, id }, 'jp-x-viral enrich 실패 · 스킵');
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, limit);

    const result: DiscoveryAdapterResult = { adapter: this.name, candidates: top };
    if (!anyPageOk) result.degradedReason = `소스 페이지 확보 실패: ${errors.join(' / ')}`;
    else if (top.length === 0) result.degradedReason = `영상 후보 0건(enrich ${enriched}건 검사).`;

    logger.info(
      { adapter: this.name, ids: orderedIds.length, enriched, videos: candidates.length, returned: top.length },
      'jp-x-viral discovery complete',
    );
    return result;
  }
}

export const jpAnimalXAdapter = new JpAnimalXAdapter();
