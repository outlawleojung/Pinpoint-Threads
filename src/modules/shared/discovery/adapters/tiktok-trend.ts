import { logger } from '../../../../config/logger.js';
import { runActorSync, isApifyConfigured } from '../../../../infra/apify-client.js';
import { isAllowedText, hasUsableMedia } from '../filters.js';
import type { DiscoveryAdapter, DiscoveryAdapterResult, DiscoveryCandidate } from '../types.js';
import { randomUUID } from 'node:crypto';

/**
 * TikTok 트렌딩 발굴 어댑터 (실험적 · 베스트에포트).
 *
 * 정서 맞는 일본·중국·동남아 TikTok 바이럴을 발굴. 단, TikTok 트렌딩은 무료·비로그인으로
 * 안정적으로 긁을 수단이 없다. → 기존 Apify 인프라에 트렌딩 액터를 연결하는 구조로 두되,
 * 액터가 설정되지 않았으면 **정직하게 degraded**(빈 결과 + 사유)로 반환한다.
 * (가짜로 동작하는 척 X — [feedback_no_silent_stopgap])
 *
 * 활성화: 환경변수 APIFY_ACTOR_TIKTOK_TREND_URL 에 트렌딩/해시태그 액터 ID 지정 시 사용.
 * 리전 힌트: APIFY_ACTOR_TIKTOK_TREND_REGION (기본 JP).
 */

const ACTOR_ID = process.env.APIFY_ACTOR_TIKTOK_TREND_URL;
const REGION = process.env.APIFY_ACTOR_TIKTOK_TREND_REGION ?? 'JP';

export class TikTokTrendAdapter implements DiscoveryAdapter {
  readonly name = 'tiktok-trend';

  async discover(limit: number): Promise<DiscoveryAdapterResult> {
    if (!isApifyConfigured() || !ACTOR_ID) {
      return {
        adapter: this.name,
        candidates: [],
        degradedReason:
          'TikTok 트렌딩 소스 미설정(APIFY_ACTOR_TIKTOK_TREND_URL 없음). 액터 지정 시 활성화.',
      };
    }

    try {
      const items = await runActorSync<Record<string, any>>({
        actorId: ACTOR_ID,
        input: { region: REGION, maxItems: Math.max(limit * 3, 15) },
        timeoutSecs: 120,
      });
      const candidates: DiscoveryCandidate[] = [];
      for (const it of items) {
        const url = (it.webVideoUrl ?? it.videoUrl ?? it.url) as string | undefined;
        const text = (it.text ?? it.desc ?? it.description ?? '') as string;
        const cover = (it.covers ?? it.cover ?? it.thumbnail) as string | undefined;
        const playCount = Number(it.playCount ?? it.diggCount ?? it.stats?.playCount ?? 0);
        if (!url) continue;
        // TikTok 영상은 미디어 1개(영상)로 간주.
        if (!hasUsableMedia(1)) continue;
        if (!isAllowedText(text)) continue;
        candidates.push({
          id: randomUUID().slice(0, 12),
          adapter: this.name,
          platform: 'tiktok',
          sourceUrl: url,
          title: (text || '(무캡션 TikTok)').replace(/\s+/g, ' ').slice(0, 60),
          text,
          thumbnailUrl: typeof cover === 'string' ? cover : Array.isArray(cover) ? cover[0] : undefined,
          mediaCount: 1,
          hasVideo: true,
          authorHandle: (it.authorMeta?.name ?? it.author?.uniqueId) as string | undefined,
          lang: undefined,
          kindHint: 'daily',
          score: playCount,
          foundAt: new Date().toISOString(),
        });
      }
      candidates.sort((a, b) => b.score - a.score);
      const top = candidates.slice(0, limit);
      logger.info({ adapter: this.name, returned: top.length, region: REGION }, 'tiktok-trend discovery complete');
      return { adapter: this.name, candidates: top };
    } catch (err) {
      return {
        adapter: this.name,
        candidates: [],
        degradedReason: `TikTok 액터 실행 실패: ${(err as Error).message}`,
      };
    }
  }
}

export const tiktokTrendAdapter = new TikTokTrendAdapter();
