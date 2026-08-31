import { logger } from '../../../../config/logger.js';
import { TrendSource } from '@prisma/client';
import type { TrendSourceAdapter, RawTrendSignal } from '../index.js';

/**
 * Google Trends 한국 급상승 검색어 어댑터.
 *
 * Google Trends RSS 피드 (/trending/rss?geo=KR) 사용.
 * 인증 불필요, 무료, 안정적. 일간 상위 ~20개 트렌드 반환.
 *
 * 이전: google-trends-api npm 라이브러리 → Google 내부 API 경로 변경으로 완전히 고장.
 * 현재: RSS XML 직접 파싱.
 */
export class GoogleTrendsAdapter implements TrendSourceAdapter {
  readonly source = TrendSource.GOOGLE_TRENDS;

  async fetchSignals(): Promise<RawTrendSignal[]> {
    try {
      const res = await fetch('https://trends.google.com/trending/rss?geo=KR', {
        headers: { 'user-agent': 'Pinpoint-Threads/1.0' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, 'google trends RSS non-OK response');
        return [];
      }

      const xml = await res.text();
      const signals = parseRss(xml);

      logger.info(
        { fetched: signals.length, top: signals.slice(0, 5).map((s) => s.keyword) },
        'google trends RSS fetched',
      );
      return signals;
    } catch (err) {
      logger.warn({ err }, 'google trends RSS fetch failed');
      return [];
    }
  }
}

function parseRss(xml: string): RawTrendSignal[] {
  const signals: RawTrendSignal[] = [];

  // <item> 블록 추출
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const title = extractTag(block, 'title');
    if (!title) continue;

    const traffic = extractTag(block, 'ht:approx_traffic');
    const newsItemTitle = extractTag(block, 'ht:news_item_title');
    const newsItemUrl = extractTag(block, 'ht:news_item_url');
    const pubDate = extractTag(block, 'pubDate');

    signals.push({
      source: TrendSource.GOOGLE_TRENDS,
      keyword: decodeEntities(title),
      currentValue: parseTraffic(traffic),
      rawPayload: {
        formattedTraffic: traffic,
        newsTitle: newsItemTitle ? decodeEntities(newsItemTitle) : undefined,
        newsUrl: newsItemUrl,
        pubDate,
      },
    });
  }

  return signals;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([^<]*)</${tag}>`, 'i');
  const m = regex.exec(xml);
  if (!m) return null;
  return (m[1] ?? m[2] ?? '').trim() || null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * "50,000+" → 50000, "1,000,000+" → 1000000
 */
function parseTraffic(formatted: string | null): number {
  if (!formatted) return 0;
  const cleaned = formatted.replace(/[,+\s]/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? 0 : n;
}
