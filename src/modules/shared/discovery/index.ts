import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { redisConnection } from '../../../queues/connection.js';
import { normalizeUrl } from '../url-ingester/platform-detector.js';
import type { DiscoveryAdapter, DiscoveryCandidate } from './types.js';
import { threadsSearchAdapter } from './adapters/threads-search.js';

export type * from './types.js';

/**
 * Discovery(발굴) 오케스트레이터.
 *
 * 활성 어댑터를 모두 돌려 정서 맞는 해외 바이럴 후보를 모으고,
 *  - 이미 인제스트한 URL(= 이미 다룬 소재)은 제외(재탕 방지)
 *  - 후보를 Redis 에 짧은 id 로 저장(텔레그램 콜백 조회용, TTL 24h)
 * → docs/08-decisions/2026-09-28-telegram-native-operation.md
 */

// 2026-09-30: 해외 스레드 검색(무료 Relay)로 교체. 우리 위너 원본이 전부 해외 스레드였음.
//   jp-x-viral(buzzweet: 일본어 자막·사건사고 혼입) · tiktok-trend(Apify 미결제) 은 제외 — 파일은 보존.
const ADAPTERS: DiscoveryAdapter[] = [threadsSearchAdapter];

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

  // 종류별(일상·쇼핑) 점수 내림차순 후 번갈아 배치 — 쇼핑은 좋아요 스케일이 작아 전역 정렬하면 묻힘.
  const byKind = (k: 'daily' | 'shopping') => all.filter((c) => c.kindHint === k).sort((a, b) => b.score - a.score);
  const d = byKind('daily');
  const s = byKind('shopping');
  const mixed: DiscoveryCandidate[] = [];
  for (let i = 0; i < Math.max(d.length, s.length); i++) {
    if (d[i]) mixed.push(d[i]!);
    if (s[i]) mixed.push(s[i]!);
  }
  const top = mixed.slice(0, limit);

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
