import { randomUUID } from 'node:crypto';
import { logger } from '../../../../config/logger.js';
import { prisma } from '../../../../db/prisma.js';
import { scrapeThreadsPage, type RelayPost } from '../../../../infra/threads-relay.js';
import { isAllowedText } from '../filters.js';
import type { DiscoveryAdapter, DiscoveryAdapterResult, DiscoveryCandidate } from '../types.js';

/**
 * 해외(일본·대만·중국) 스레드 검색 → 발굴 후보. **비로그인 Relay 파싱(무료)**.
 *
 * 근거(2026-09-30 실데이터): 우리 1천뷰+ 글 10개 전부 해외 스레드 원본(aozora_0522·zzbb520·yuwen__1106…).
 *   - daily  : 동물·웃긴 **영상**만 (말 없이 통하는 것 — 해외 이슈는 한국 정서와 안 맞을 수 있어 제외)
 *   - shopping: 구매후기 키워드("買ってよかった"·"好物分享"…) — [🛍 쇼핑글] 누르면 기존 자동 식별→쿠팡 매칭
 * LLM 안 씀. 실행당 검색어 일부만 로테이션(속도·차단 위험↓).
 */

// ⚠️ 띄어쓰기 있는 검색어는 결과 0건(실측) → 한 단어만.
//   실측(2026-09-30): 柴犬·おもしろ動画·貓咪 = 좋아요 1천+ 영상 다수 / 買ってよかった·好物分享·必買 = 상품 후기 다수.
//   購入品(반응 약함)·開箱(폭포·모텔 등 비상품 혼입) 제외.
const DAILY_QUERIES = ['柴犬', '猫', '子猫', '犬', 'おもしろ動画', '癒し動画', '貓咪', '狗狗', '萌寵'];
const SHOP_QUERIES = ['買ってよかった', '好物分享', '必買', '愛用品', '便利グッズ', '神アイテム', '無印良品', 'ダイソー'];

const DAILY_MIN_LIKES = 1000;
/**
 * ★ 반응형 필터 (실측 2026-09-30, 일상 20건): 원본 댓글/좋아요 ≥2% 영상 → 6건 중 4건 8천~2만뷰,
 *   <1%("보고 끝" 귀여움) → 8건 중 7건 300뷰 이하. 좋아요 크기는 무관. → 1.5% 이상만, 댓글 수로 랭킹.
 */
const DAILY_MIN_REPLY_RATIO = 0.015;
const SHOP_MIN_LIKES = 300;
// 동물·웃긴 영상은 에버그린(한국엔 처음) → 1년. 쇼핑은 시즌·재고 → 90일. (실측: 좋은 영상 대부분 60~180일)
const DAILY_MAX_AGE_DAYS = 365;
const SHOP_MAX_AGE_DAYS = 90;
const FOREIGN_LANGS = new Set(['ja', 'zh', 'zh-TW', 'zh-CN', 'zh-Hant', 'zh-Hans', 'en']);

function pick<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function isForeign(p: RelayPost): boolean {
  if (p.language) return FOREIGN_LANGS.has(p.language) || p.language.startsWith('zh');
  // 언어 미표기 → 한글 포함이면 국내글로 보고 제외
  return !/[가-힣]/.test(p.text);
}

function fresh(p: RelayPost, maxDays: number): boolean {
  return !p.takenAt || Date.now() - p.takenAt.getTime() <= maxDays * 864e5;
}

function toCandidate(p: RelayPost, kindHint: 'daily' | 'shopping', query: string): DiscoveryCandidate {
  const hasVideo = p.media.some((m) => m.kind === 'video');
  return {
    id: randomUUID().slice(0, 8),
    adapter: `threads-search:${query}`,
    platform: 'threads',
    sourceUrl: p.permalink,
    title: p.text.replace(/\s+/g, ' ').slice(0, 80),
    text: p.text,
    thumbnailUrl: p.thumbnailUrl ?? undefined,
    mediaCount: p.media.length,
    hasVideo,
    authorHandle: p.username ?? undefined,
    lang: p.language ?? undefined,
    kindHint,
    score: kindHint === 'daily' ? p.replies : p.likes,
    likes: p.likes,
    replies: p.replies,
    foundAt: new Date().toISOString(),
  };
}

async function searchOnce(query: string): Promise<RelayPost[]> {
  const url = `https://www.threads.com/search?q=${encodeURIComponent(query)}&serp_type=default`;
  try {
    return await scrapeThreadsPage(url, { scrolls: 2, locale: /[ぁ-んァ-ン]/.test(query) ? 'ja-JP' : 'zh-TW' });
  } catch (err) {
    logger.warn({ err: (err as Error).message, query }, 'threads-search: 검색 실패');
    return [];
  }
}

export const threadsSearchAdapter: DiscoveryAdapter = {
  name: 'threads-search',
  async discover(limit: number): Promise<DiscoveryAdapterResult> {
    const own = new Set((await prisma.account.findMany({ select: { handle: true } })).map((a) => a.handle.toLowerCase()));
    const seen = new Set<string>();
    const daily: DiscoveryCandidate[] = [];
    const shop: DiscoveryCandidate[] = [];
    let searched = 0;
    let empty = 0;

    // 순차 실행(동시 X) — 차단 위험↓
    for (const q of pick(DAILY_QUERIES, 5)) {
      const posts = await searchOnce(q);
      searched += 1;
      if (posts.length === 0) empty += 1;
      for (const p of posts) {
        if (seen.has(p.code) || own.has((p.username ?? '').toLowerCase())) continue;
        seen.add(p.code);
        if (!p.media.some((m) => m.kind === 'video')) continue; // 동물·웃긴 건 영상만
        if (p.likes < DAILY_MIN_LIKES || !fresh(p, DAILY_MAX_AGE_DAYS) || !isForeign(p) || !isAllowedText(p.text)) continue;
        if (p.replies / Math.max(1, p.likes) < DAILY_MIN_REPLY_RATIO) continue; // 반응(댓글) 없는 "보고 끝" 영상 제외
        daily.push(toCandidate(p, 'daily', q));
      }
    }
    for (const q of pick(SHOP_QUERIES, 3)) {
      const posts = await searchOnce(q);
      searched += 1;
      if (posts.length === 0) empty += 1;
      for (const p of posts) {
        if (seen.has(p.code) || own.has((p.username ?? '').toLowerCase())) continue;
        seen.add(p.code);
        if (p.media.length === 0) continue;
        if (p.likes < SHOP_MIN_LIKES || !fresh(p, SHOP_MAX_AGE_DAYS) || !isForeign(p) || !isAllowedText(p.text)) continue;
        shop.push(toCandidate(p, 'shopping', q));
      }
    }

    daily.sort((a, b) => b.score - a.score);
    shop.sort((a, b) => b.score - a.score);
    // 일상·쇼핑 반반 (한쪽이 모자라면 다른 쪽으로 채움)
    const half = Math.ceil(limit / 2);
    const out = [...daily.slice(0, half), ...shop.slice(0, limit - Math.min(half, daily.length))].slice(0, limit);
    logger.info({ searched, empty, daily: daily.length, shop: shop.length, returned: out.length }, 'threads-search discover');
    return {
      adapter: 'threads-search',
      candidates: out,
      ...(empty === searched ? { degradedReason: '스레드 검색 결과 0건(차단·구조 변경 의심)' } : {}),
    };
  },
};
