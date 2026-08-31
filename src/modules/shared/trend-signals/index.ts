import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import type { TrendSource, TrendCategory } from '@prisma/client';

/**
 * Trend Signal 정규화 프레임워크.
 *
 * 여러 소스(네이버 데이터랩·Google Trends·TikTok CC 등)의 신호를 공통 TrendSignal로 통합.
 * 각 소스는 TrendSourceAdapter를 구현하여 fetchSignals()로 원시 신호 배열을 emit.
 *
 * upsertSignal이 자동으로:
 *   - 기존 (source, keyword) 있으면 previousValue ← currentValue, currentValue ← 새 값
 *   - velocityPct 자동 계산
 *   - crossPlatformScore 갱신
 *   - lastSeenAt · observationCount 갱신
 */

export interface RawTrendSignal {
  source: TrendSource;
  keyword: string;
  category?: TrendCategory;
  brand?: string;
  productHint?: string;
  currentValue: number;
  rawPayload?: unknown;
}

export interface TrendSourceAdapter {
  source: TrendSource;
  fetchSignals(): Promise<RawTrendSignal[]>;
}

export interface UpsertResult {
  id: string;
  isNew: boolean;
  velocityPct: number | null;
}

export async function upsertSignal(raw: RawTrendSignal): Promise<UpsertResult> {
  const existing = await prisma.trendSignal.findUnique({
    where: { source_keyword: { source: raw.source, keyword: raw.keyword } },
  });

  if (!existing) {
    const created = await prisma.trendSignal.create({
      data: {
        source: raw.source,
        keyword: raw.keyword,
        category: raw.category,
        brand: raw.brand,
        productHint: raw.productHint,
        currentValue: raw.currentValue,
        previousValue: null,
        velocityPct: null,
        rawPayload: raw.rawPayload as any,
      },
    });
    return { id: created.id, isNew: true, velocityPct: null };
  }

  const previousValue = existing.currentValue;
  const currentValue = raw.currentValue;
  const velocityPct =
    previousValue !== 0
      ? ((currentValue - previousValue) / Math.abs(previousValue)) * 100
      : null;

  const updated = await prisma.trendSignal.update({
    where: { id: existing.id },
    data: {
      currentValue,
      previousValue,
      velocityPct,
      category: raw.category ?? existing.category,
      brand: raw.brand ?? existing.brand,
      productHint: raw.productHint ?? existing.productHint,
      lastSeenAt: new Date(),
      observationCount: { increment: 1 },
      decayedAt: null, // 새 관측 → 감쇠 해제
      rawPayload: raw.rawPayload as any,
    },
  });

  return { id: updated.id, isNew: false, velocityPct };
}

/**
 * 여러 소스에서 같은 키워드 감지 시 크로스 플랫폼 확신도 상승.
 * 대소문자·공백 정규화 후 매칭.
 */
export async function updateCrossPlatformScores(): Promise<number> {
  const raw = await prisma.$queryRaw<Array<{ normalized_keyword: string; count: bigint }>>`
    SELECT LOWER(TRIM(keyword)) as normalized_keyword, COUNT(DISTINCT source) as count
    FROM "TrendSignal"
    WHERE "decayedAt" IS NULL
    GROUP BY LOWER(TRIM(keyword))
    HAVING COUNT(DISTINCT source) > 1
  `;

  let updated = 0;
  for (const row of raw) {
    const count = Number(row.count);
    const affected = await prisma.trendSignal.updateMany({
      where: {
        decayedAt: null,
        keyword: { equals: row.normalized_keyword, mode: 'insensitive' },
      },
      data: { crossPlatformScore: count },
    });
    updated += affected.count;
  }
  return updated;
}

/**
 * 오래된 신호 감쇠 (기본 14일).
 */
export async function decayOldSignals(withinDays = 14): Promise<number> {
  const threshold = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  const result = await prisma.trendSignal.updateMany({
    where: { lastSeenAt: { lt: threshold }, decayedAt: null },
    data: { decayedAt: new Date() },
  });
  return result.count;
}

/**
 * 활성 상위 트렌드 조회 (velocity + crossPlatform 가중).
 */
export interface TopSignalsFilter {
  limit?: number;
  category?: TrendCategory;
  minVelocityPct?: number;
  minCrossPlatform?: number;
}

export async function getTopActiveSignals(filter: TopSignalsFilter = {}) {
  const { limit = 20, category, minVelocityPct, minCrossPlatform } = filter;
  return prisma.trendSignal.findMany({
    where: {
      decayedAt: null,
      ...(category ? { category } : {}),
      ...(minVelocityPct !== undefined ? { velocityPct: { gte: minVelocityPct } } : {}),
      ...(minCrossPlatform !== undefined
        ? { crossPlatformScore: { gte: minCrossPlatform } }
        : {}),
    },
    orderBy: [{ crossPlatformScore: 'desc' }, { velocityPct: 'desc' }, { lastSeenAt: 'desc' }],
    take: limit,
  });
}

/**
 * 등록된 어댑터들을 순회하며 fetchSignals → upsert.
 * cron 또는 bullmq에서 주기적으로 호출.
 */
export async function pollAllAdapters(adapters: TrendSourceAdapter[]): Promise<{
  source: TrendSource;
  fetched: number;
  upserted: number;
  errors: string[];
}[]> {
  const summary: Array<{
    source: TrendSource;
    fetched: number;
    upserted: number;
    errors: string[];
  }> = [];

  for (const adapter of adapters) {
    const bucket = { source: adapter.source, fetched: 0, upserted: 0, errors: [] as string[] };
    try {
      const raws = await adapter.fetchSignals();
      bucket.fetched = raws.length;
      for (const r of raws) {
        try {
          await upsertSignal(r);
          bucket.upserted += 1;
        } catch (err) {
          bucket.errors.push(`upsert:${r.keyword}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      bucket.errors.push(`fetch: ${(err as Error).message}`);
    }
    summary.push(bucket);
    logger.info(
      { source: adapter.source, fetched: bucket.fetched, upserted: bucket.upserted, errors: bucket.errors.length },
      'trend adapter polled',
    );
  }

  // 크로스 플랫폼 확신도 재계산
  try {
    const affected = await updateCrossPlatformScores();
    logger.info({ affected }, 'cross-platform scores updated');
  } catch (err) {
    logger.error({ err }, 'cross-platform score update failed');
  }

  return summary;
}
