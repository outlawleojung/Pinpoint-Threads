import { request } from 'undici';
import { env } from '../../../../config/env.js';
import { logger } from '../../../../config/logger.js';
import { TrendSource } from '@prisma/client';
import { runActorSync, isApifyConfigured } from '../../../../infra/apify-client.js';
import type { TrendSourceAdapter, RawTrendSignal } from '../index.js';

/**
 * TikTok Creative Center 트렌드 어댑터.
 *
 * TikTok CC는 공식 API 없음. 두 가지 경로:
 *   A. 공개 JSON 엔드포인트 (인증 없이 접근 가능하나 자주 변경·차단됨)
 *   B. Apify 액터 (안정, 유료) — APIFY_ACTOR_TIKTOK_CC 설정 시 활성화
 *
 * 두 경로 모두 실패 시 조용히 skip (빈 배열 반환).
 * KR 지역 · 최근 트렌드 해시태그·상품·소재 대상.
 */

const CC_HOT_LIST_URL =
  'https://ads.tiktok.com/business/creativecenter/api/pc/trends/homepage/hot_list/pc/en';

// 국가 코드 KR, 카테고리 all, 마지막 24h
const DEFAULT_PARAMS = {
  page: '1',
  limit: '30',
  period: '7',
  country_code: 'KR',
  language: 'ko',
};

interface HotListResponse {
  code?: number;
  data?: {
    hashtag_list?: Array<{
      hashtag_name: string;
      publish_cnt?: number;
      video_views?: number;
      trend?: unknown;
    }>;
  };
}

export class TikTokCreativeCenterAdapter implements TrendSourceAdapter {
  readonly source = TrendSource.TIKTOK_CREATIVE_CENTER;

  async fetchSignals(): Promise<RawTrendSignal[]> {
    // 우선 Apify 액터 있으면 그걸로
    const apifyActorEnvKey = 'APIFY_ACTOR_TIKTOK_CC';
    const actorId = (env as unknown as Record<string, string | undefined>)[apifyActorEnvKey];
    if (isApifyConfigured() && actorId) {
      return this.fetchViaApify(actorId);
    }

    // fallback: 공개 엔드포인트 직접 조회 (best effort)
    return this.fetchDirect();
  }

  private async fetchDirect(): Promise<RawTrendSignal[]> {
    try {
      const params = new URLSearchParams(DEFAULT_PARAMS);
      const res = await request(`${CC_HOT_LIST_URL}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          accept: 'application/json',
          'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
          referer: 'https://ads.tiktok.com/business/creativecenter/pc/en',
        },
      });

      if (res.statusCode >= 400) {
        logger.warn(
          { statusCode: res.statusCode },
          'tiktok CC direct fetch blocked — APIFY_ACTOR_TIKTOK_CC 설정 권장',
        );
        return [];
      }

      const json = (await res.body.json()) as HotListResponse;
      const hashtags = json?.data?.hashtag_list ?? [];

      const signals: RawTrendSignal[] = hashtags.map((h) => ({
        source: this.source,
        keyword: `#${h.hashtag_name}`,
        currentValue: Number(h.video_views ?? h.publish_cnt ?? 0),
        rawPayload: h as unknown as Record<string, unknown>,
      }));

      logger.info(
        { fetched: signals.length, method: 'direct' },
        'tiktok CC fetched',
      );
      return signals;
    } catch (err) {
      logger.warn(
        { err },
        'tiktok CC direct fetch failed — 공개 엔드포인트 변경 가능. APIFY_ACTOR_TIKTOK_CC 설정 권장',
      );
      return [];
    }
  }

  private async fetchViaApify(actorId: string): Promise<RawTrendSignal[]> {
    try {
      const items = await runActorSync<Record<string, unknown>>({
        actorId,
        input: {
          country: 'KR',
          language: 'ko',
          period: 7,
          category: 'all',
        },
        timeoutSecs: 240,
      });

      const signals: RawTrendSignal[] = items.map((item) => {
        const name =
          (item.hashtag_name as string | undefined) ??
          (item.name as string | undefined) ??
          (item.keyword as string | undefined) ??
          '';
        const views =
          Number(item.video_views ?? item.views ?? item.value ?? item.publish_cnt ?? 0) || 0;
        return {
          source: this.source,
          keyword: name ? `#${name.replace(/^#/, '')}` : String(name),
          currentValue: views,
          rawPayload: item,
        };
      }).filter((s) => s.keyword.length > 1);

      logger.info(
        { fetched: signals.length, method: 'apify', actorId },
        'tiktok CC fetched via apify',
      );
      return signals;
    } catch (err) {
      logger.warn({ err, actorId }, 'tiktok CC apify fetch failed');
      return [];
    }
  }
}
