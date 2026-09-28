import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { redisConnection } from '../../../queues/connection.js';
import { normalizeUrl } from '../url-ingester/platform-detector.js';
import type { DiscoveryAdapter, DiscoveryCandidate } from './types.js';
import { jpAnimalXAdapter } from './adapters/jp-animal-x.js';
import { tiktokTrendAdapter } from './adapters/tiktok-trend.js';

export type * from './types.js';

/**
 * Discovery(발굴) 오케스트레이터.
 *
 * 활성 어댑터를 모두 돌려 정서 맞는 해외 바이럴 후보를 모으고,
 *  - 이미 인제스트한 URL(= 이미 다룬 소재)은 제외(재탕 방지)
 *  - 후보를 Redis 에 짧은 id 로 저장(텔레그램 콜백 조회용, TTL 24h)
 * → docs/08-decisions/2026-09-28-telegram-native-operation.md
 */

const ADAPTERS: DiscoveryAdapter[] = [jpAnimalXAdapter, tiktokTrendAdapter];

const REDIS_PREFIX = 'discovery:';
const TTL_SEC = 24 * 60 * 60;

export interface DiscoverResult {
  candidates: DiscoveryCandidate[];
  /** degraded(소스 미확보/차단) 어댑터별 사유 — 사용자에게 투명하게 보고. */
  degraded: Array<{ adapter: string; reason: string }>;
}

export async function discoverCandidates(opts?: { limit?: number; perAdapter?: number }): Promise<DiscoverResult> {
  const limit = opts?.limit ?? 8;
  const perAdapter = opts?.perAdapter ?? Math.max(limit, 6);

  const results = await Promise.all(
    ADAPTERS.map((a) =>
      a.discover(perAdapter).catch((err) => {
        logger.error({ err, adapter: a.name }, 'discovery adapter threw');
        return { adapter: a.name, candidates: [], degradedReason: (err as Error).message };
      }),
    ),
  );

  const degraded: DiscoverResult['degraded'] = [];
  let all: DiscoveryCandidate[] = [];
  for (const r of results) {
    if (r.degradedReason) degraded.push({ adapter: r.adapter, reason: r.degradedReason });
    all.push(...r.candidates);
  }

  // 이미 다룬 URL 제외 (InboundLink 존재 = 과거 인제스트). 재탕 방지.
  all = await filterAlreadyHandled(all);

  // 어댑터 교차 랭킹: 점수 내림차순 (플랫폼별 score 스케일이 달라 완벽하진 않지만 근사).
  all.sort((a, b) => b.score - a.score);
  const top = all.slice(0, limit);

  // Redis 저장 (콜백에서 id 로 조회).
  await Promise.all(
    top.map((c) => redisConnection.set(REDIS_PREFIX + c.id, JSON.stringify(c), 'EX', TTL_SEC)),
  );

  logger.info(
    { returned: top.length, totalFound: all.length, degraded: degraded.map((d) => d.adapter) },
    'discoverCandidates complete',
  );
  return { candidates: top, degraded };
}

async function filterAlreadyHandled(candidates: DiscoveryCandidate[]): Promise<DiscoveryCandidate[]> {
  if (candidates.length === 0) return [];
  const normalized = candidates.map((c) => normalizeUrl(c.sourceUrl));
  const existing = await prisma.inboundLink.findMany({
    where: { normalizedUrl: { in: normalized } },
    select: { normalizedUrl: true },
  });
  const handled = new Set(existing.map((e) => e.normalizedUrl));
  return candidates.filter((c) => !handled.has(normalizeUrl(c.sourceUrl)));
}

export async function getCandidate(id: string): Promise<DiscoveryCandidate | null> {
  const raw = await redisConnection.get(REDIS_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DiscoveryCandidate;
  } catch {
    return null;
  }
}

export async function clearCandidate(id: string): Promise<void> {
  await redisConnection.del(REDIS_PREFIX + id);
}
