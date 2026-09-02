import { InboundPlatform, InboundSource, InboundStatus } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { detectPlatform, extractUrls, normalizeUrl, splitBenchmarkAndCommerce } from './platform-detector.js';
import { getAdapter } from './adapters/registry.js';
import { maybeAutoPromote } from '../source-collector/promoter.js';

/**
 * URL Ingester — Lane 1 (수동 텔레그램) + Lane 2 (자율 트렌드) 공통 진입점.
 *
 * 책임:
 *   1) URL 정규화 + 플랫폼 감지
 *   2) InboundLink 레코드 upsert (dedup)
 *   3) Adapter 디스패치 (플랫폼별 fetch 로직)
 *   4) 상태 추적
 *
 * Adapter 구현은 Task #6b (Threads) 부터 순차. 지금은 등록·라우팅까지만.
 */

export interface IngestInput {
  url: string;
  source: InboundSource;
  trendSignalId?: string;
  /** 사용자가 같은 텔레그램 메시지에 붙인 Coupang 등 커머스 URL (Pipeline A 매칭 스킵용). */
  manualCommerceUrl?: string;
}

export interface IngestResult {
  inboundLinkId: string;
  platform: InboundPlatform;
  status: InboundStatus;
  isNew: boolean;
  message: string;
}

export class UnsupportedPlatformError extends Error {
  constructor(url: string) {
    super(`Unsupported platform for URL: ${url}`);
    this.name = 'UnsupportedPlatformError';
  }
}

export async function ingestUrl(input: IngestInput): Promise<IngestResult> {
  const normalized = normalizeUrl(input.url);
  const platform = detectPlatform(normalized);

  const existing = await prisma.inboundLink.findUnique({
    where: { normalizedUrl: normalized },
  });

  if (existing) {
    logger.info(
      { inboundLinkId: existing.id, platform, status: existing.status },
      'URL already ingested (dedup hit)',
    );
    return {
      inboundLinkId: existing.id,
      platform: existing.platform,
      status: existing.status,
      isNew: false,
      message: `이미 등록된 URL입니다 (상태: ${existing.status}).`,
    };
  }

  if (platform === InboundPlatform.UNKNOWN) {
    logger.warn({ url: input.url, normalized }, 'unknown platform, storing anyway');
  }

  const link = await prisma.inboundLink.create({
    data: {
      url: input.url,
      normalizedUrl: normalized,
      platform,
      source: input.source,
      status: platform === InboundPlatform.UNKNOWN ? InboundStatus.FAILED : InboundStatus.RECEIVED,
      trendSignalId: input.trendSignalId,
      manualCommerceUrl: input.manualCommerceUrl ?? null,
      errorMessage: platform === InboundPlatform.UNKNOWN ? 'Unsupported platform' : null,
    },
  });

  logger.info(
    { inboundLinkId: link.id, platform, source: input.source },
    'URL ingested (RECEIVED)',
  );

  if (platform === InboundPlatform.UNKNOWN) {
    return {
      inboundLinkId: link.id,
      platform,
      status: link.status,
      isNew: true,
      message: `지원하지 않는 플랫폼입니다: ${normalized}`,
    };
  }

  // Adapter 디스패치 (동기: 짧은 fetch면 즉시 응답 가능, 장시간은 이후 BullMQ 이관)
  const adapter = getAdapter(platform);
  if (!adapter) {
    await prisma.inboundLink.update({
      where: { id: link.id },
      data: { status: InboundStatus.FAILED, errorMessage: 'Adapter not implemented yet' },
    });
    return {
      inboundLinkId: link.id,
      platform,
      status: InboundStatus.FAILED,
      isNew: true,
      message: `${platform} 어댑터 미구현 (Task #6e/f/g에서 활성화).`,
    };
  }

  await prisma.inboundLink.update({
    where: { id: link.id },
    data: { status: InboundStatus.FETCHING },
  });

  try {
    const fetched = await adapter({ url: normalized });
    const updated = await prisma.inboundLink.update({
      where: { id: link.id },
      data: {
        status: InboundStatus.FETCHED,
        rawText: fetched.text,
        rawLanguage: fetched.language,
        mediaUrls: fetched.mediaUrls,
        authorHandle: fetched.authorHandle,
        engagement: fetched.engagement as any,
        publishedAt: fetched.publishedAt,
      },
    });
    logger.info(
      {
        inboundLinkId: link.id,
        platform,
        textLen: fetched.text.length,
        mediaCount: fetched.mediaUrls.length,
      },
      'URL ingested (FETCHED)',
    );

    // 자동 벤치마크 승격 판정 (best effort)
    let promoteNote = '';
    try {
      const promote = await maybeAutoPromote(updated);
      if (promote.status === 'promoted') {
        promoteNote = ` · 🎯 벤치마크 자동 승격됨`;
      } else if (promote.status === 'already_promoted') {
        promoteNote = ` · 벤치마크 기존 존재`;
      }
    } catch (err) {
      logger.warn({ err, inboundLinkId: link.id }, 'auto-promote failed');
    }

    return {
      inboundLinkId: link.id,
      platform,
      status: updated.status,
      isNew: true,
      message:
        `${platform} 조회 완료 — 저자: ${fetched.authorHandle ?? '?'} · ` +
        `본문 ${fetched.text.length}자 · 미디어 ${fetched.mediaUrls.length}개 · 언어 ${fetched.language ?? '?'}` +
        promoteNote,
    };
  } catch (err) {
    const errorMessage = (err as Error)?.message ?? String(err);
    await prisma.inboundLink.update({
      where: { id: link.id },
      data: { status: InboundStatus.FAILED, errorMessage },
    });
    logger.error({ err, inboundLinkId: link.id, platform }, 'adapter fetch failed');
    return {
      inboundLinkId: link.id,
      platform,
      status: InboundStatus.FAILED,
      isNew: true,
      message: `${platform} 조회 실패: ${errorMessage}`,
    };
  }
}

export interface BatchIngestResult {
  total: number;
  results: IngestResult[];
}

export async function ingestUrlsFromText(
  text: string,
  source: InboundSource,
): Promise<BatchIngestResult> {
  const { benchmarkUrls, commerceUrls } = splitBenchmarkAndCommerce(text);
  const results: IngestResult[] = [];

  // 벤치마크 URL 이 없고 커머스 URL 만 있으면 스킵 (attach 대상 없음)
  if (benchmarkUrls.length === 0 && commerceUrls.length > 0) {
    logger.warn({ commerceUrls }, 'commerce URL only, no benchmark URL to attach → skip');
    return { total: 0, results: [] };
  }

  // 같은 메시지의 첫 번째 커머스 URL 을 모든 벤치마크 URL 에 attach.
  // (여러 커머스 URL 전송 케이스는 나중 별도 처리)
  const attachedCommerceUrl = commerceUrls[0];

  for (const url of benchmarkUrls) {
    try {
      results.push(await ingestUrl({ url, source, manualCommerceUrl: attachedCommerceUrl }));
    } catch (err) {
      logger.error({ err, url }, 'ingest failed');
      results.push({
        inboundLinkId: '',
        platform: InboundPlatform.UNKNOWN,
        status: InboundStatus.FAILED,
        isNew: false,
        message: `실패: ${(err as Error).message}`,
      });
    }
  }
  return { total: results.length, results };
}
