import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';

/**
 * Performance Collector — 발행 24h/72h 후 Threads Insights 회수.
 * engagementScore 계산 후 threshold 넘으면 BenchmarkPost 자동 승격.
 *
 * TODO(Phase 4e):
 * - Threads Insights API 호출 (Meta 승인 필요)
 * - engagementScore 로직 (calcEngagementScore, docs/05-data-collection/benchmark-schema.md)
 * - BenchmarkPost 승격 로직 (shouldPromote)
 */

export async function collectPerformance(_postId: string): Promise<void> {
  logger.warn({ postId: _postId }, 'performance-collector not implemented (Phase 4e)');
  // Placeholder to avoid unused imports lint later
  await prisma.$queryRaw`SELECT 1`;
}
