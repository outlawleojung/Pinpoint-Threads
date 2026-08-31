import { logger } from '../../../../config/logger.js';
import { TrendSource } from '@prisma/client';
import type { TrendSourceAdapter, RawTrendSignal } from '../index.js';

// google-trends-api는 @types 미제공 → 최소 shape 선언
// @ts-ignore
import googleTrends from 'google-trends-api';

interface DailyTrendsResponse {
  default: {
    trendingSearchesDays: Array<{
      date: string;
      trendingSearches: Array<{
        title: { query: string; exploreLink?: string };
        formattedTraffic: string;
        image?: { imageUrl?: string; source?: string; newsUrl?: string };
        articles?: Array<{ title: string; timeAgo?: string; source?: string; url?: string }>;
        relatedQueries?: Array<{ query: string; exploreLink?: string }>;
      }>;
    }>;
  };
}

/**
 * Google Trends 한국 급상승 검색어 어댑터.
 *
 * `dailyTrends` API는 인증 불필요 (unofficial, 라이브러리 스크래핑).
 * 간헐적 실패 가능성 있음 → try/catch로 감싸고 skip.
 *
 * formattedTraffic ("50K+", "200K+") 를 수치로 파싱해 currentValue로 사용.
 */
export class GoogleTrendsAdapter implements TrendSourceAdapter {
  readonly source = TrendSource.GOOGLE_TRENDS;

  async fetchSignals(): Promise<RawTrendSignal[]> {
    try {
      const raw = await googleTrends.dailyTrends({
        geo: 'KR',
        hl: 'ko',
      });
      const parsed = JSON.parse(raw as string) as DailyTrendsResponse;

      const signals: RawTrendSignal[] = [];
      for (const day of parsed.default.trendingSearchesDays ?? []) {
        for (const item of day.trendingSearches ?? []) {
          const traffic = parseTraffic(item.formattedTraffic);
          signals.push({
            source: this.source,
            keyword: item.title.query,
            currentValue: traffic,
            rawPayload: {
              date: day.date,
              formattedTraffic: item.formattedTraffic,
              relatedQueries: item.relatedQueries?.map((q) => q.query),
              imageUrl: item.image?.imageUrl,
            },
          });
        }
      }

      logger.info(
        { fetched: signals.length, top: signals.slice(0, 5).map((s) => s.keyword) },
        'google trends daily fetched',
      );
      return signals;
    } catch (err) {
      logger.warn({ err }, 'google trends fetch failed (unofficial API 간헐적 실패)');
      return [];
    }
  }
}

/**
 * "50K+" → 50000, "1M+" → 1000000
 */
function parseTraffic(formatted: string | undefined): number {
  if (!formatted) return 0;
  const m = /^([\d.]+)([KM]?)/i.exec(formatted.trim());
  if (!m) return 0;
  const num = parseFloat(m[1] ?? '0');
  const unit = (m[2] ?? '').toUpperCase();
  if (unit === 'M') return num * 1_000_000;
  if (unit === 'K') return num * 1_000;
  return num;
}
