import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { InboundPlatform, InboundSource, type TrendSignal } from '@prisma/client';
import { llm } from '../../../infra/llm/index.js';
import {
  runActorSync,
  isApifyConfigured,
  ApifyNotConfiguredError,
} from '../../../infra/apify-client.js';
import { ingestUrl } from '../url-ingester/index.js';
import { getTopActiveSignals } from './index.js';

/**
 * Lane 2 트렌드 → 플랫폼 능동 검색 오케스트레이터 (Task #7d).
 *
 * 흐름:
 *   1) 활성 상위 TrendSignal N개 조회 (velocity + crossPlatform 순)
 *   2) 각 시그널 키워드를 대상 플랫폼 언어로 번역 (Claude)
 *   3) 각 플랫폼(XHS·TikTok·IG·Threads)에서 Apify 액터로 키워드 검색
 *   4) 결과 URL 리스트 dedup + Ingester에 자동 투입 (source=AUTONOMOUS_TREND)
 *
 * 액터 미설정 플랫폼은 skip.
 */

const PLATFORM_CONFIG: Array<{
  platform: InboundPlatform;
  actorEnv: keyof typeof env;
  targetLang: 'ko' | 'en' | 'ja' | 'zh';
}> = [
  { platform: InboundPlatform.THREADS, actorEnv: 'APIFY_ACTOR_THREADS_KEYWORD', targetLang: 'ko' },
  { platform: InboundPlatform.TIKTOK, actorEnv: 'APIFY_ACTOR_TIKTOK_KEYWORD', targetLang: 'en' },
  { platform: InboundPlatform.INSTAGRAM, actorEnv: 'APIFY_ACTOR_IG_KEYWORD', targetLang: 'en' },
  { platform: InboundPlatform.XIAOHONGSHU, actorEnv: 'APIFY_ACTOR_XHS_KEYWORD', targetLang: 'zh' },
];

export interface SearchIngestOptions {
  topSignals?: number;         // 상위 몇 개 시그널 대상 (기본 5)
  perPlatformResults?: number; // 플랫폼당 몇 개 URL 후보 (기본 10)
  minLikes?: number;           // 필터 하한 (기본 100)
  translateFrom?: 'ko';        // 원본 키워드 언어 (기본 ko)
}

export interface SearchIngestSummary {
  signalsProcessed: number;
  perPlatform: Array<{
    platform: InboundPlatform;
    searchedKeywords: number;
    candidates: number;
    ingested: number;
    errors: string[];
  }>;
}

export async function runTrendSearchIngest(
  opts: SearchIngestOptions = {},
): Promise<SearchIngestSummary> {
  const topN = opts.topSignals ?? 5;
  const perPlatform = opts.perPlatformResults ?? 10;
  const minLikes = opts.minLikes ?? 100;

  if (!isApifyConfigured()) throw new ApifyNotConfiguredError();

  const signals = await getTopActiveSignals({ limit: topN });
  logger.info({ topN, found: signals.length }, 'trend search orchestrator start');

  const perPlatformMap: SearchIngestSummary['perPlatform'] = PLATFORM_CONFIG.filter((c) =>
    Boolean((env as any)[c.actorEnv]),
  ).map((c) => ({
    platform: c.platform,
    searchedKeywords: 0,
    candidates: 0,
    ingested: 0,
    errors: [],
  }));

  if (perPlatformMap.length === 0) {
    logger.warn('설정된 APIFY_ACTOR_*_KEYWORD 없음 → 트렌드 검색 skip');
    return { signalsProcessed: 0, perPlatform: [] };
  }

  for (const signal of signals) {
    for (const cfg of PLATFORM_CONFIG) {
      const actorId = (env as any)[cfg.actorEnv] as string | undefined;
      if (!actorId) continue;
      const bucket = perPlatformMap.find((p) => p.platform === cfg.platform)!;

      try {
        const translated = await translateKeyword(signal.keyword, cfg.targetLang);
        bucket.searchedKeywords += 1;

        const results = await searchKeywordViaApify({
          actorId,
          keyword: translated,
          maxResults: perPlatform,
        });
        bucket.candidates += results.length;

        for (const r of results) {
          if (r.likes !== undefined && r.likes < minLikes) continue;
          if (!r.url) continue;
          try {
            const ing = await ingestUrl({
              url: r.url,
              source: InboundSource.AUTONOMOUS_TREND,
              trendSignalId: signal.id,
            });
            if (ing.isNew) bucket.ingested += 1;
          } catch (err) {
            bucket.errors.push(`ingest ${r.url}: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        bucket.errors.push(
          `signal="${signal.keyword}" platform=${cfg.platform}: ${(err as Error).message}`,
        );
        logger.warn(
          { err, signal: signal.keyword, platform: cfg.platform },
          'trend search step failed',
        );
      }
    }
  }

  const totalIngested = perPlatformMap.reduce((a, b) => a + b.ingested, 0);
  logger.info(
    { signals: signals.length, totalIngested, perPlatform: perPlatformMap },
    'trend search orchestrator done',
  );

  return { signalsProcessed: signals.length, perPlatform: perPlatformMap };
}

/**
 * 키워드 번역. 원본이 대상 언어와 같으면 그대로 반환.
 * 짧은 프롬프트로 Claude Haiku 사용 (비용 최소화).
 */
export async function translateKeyword(
  keyword: string,
  targetLang: 'ko' | 'en' | 'ja' | 'zh',
): Promise<string> {
  if (looksLikeLanguage(keyword, targetLang)) return keyword;

  const langNames: Record<string, string> = {
    ko: '한국어',
    en: '영어',
    ja: '일본어',
    zh: '중국어 간체',
  };

  const res = await llm().complete({
    tier: 'fast',
    system: `상품·트렌드 검색어 번역기. 짧고 자연스러운 ${langNames[targetLang]} 검색어로 변환. 부연 설명·따옴표 없이 결과만 출력.`,
    userParts: [
      {
        type: 'text',
        text: `이 검색어를 ${langNames[targetLang]}로 자연스럽게 번역:\n${keyword}\n\n결과 검색어만 출력:`,
      },
    ],
    maxOutputTokens: 60,
    temperature: 0.3,
  });

  const cleaned = res.text.trim().replace(/^["'`]|["'`]$/g, '').split('\n')[0]?.trim();
  return cleaned || keyword;
}

function looksLikeLanguage(text: string, lang: 'ko' | 'en' | 'ja' | 'zh'): boolean {
  const hangul = (text.match(/[가-힯]/g) ?? []).length;
  const hiragana = (text.match(/[぀-ヿ]/g) ?? []).length;
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;

  if (lang === 'ko') return hangul > 0;
  if (lang === 'ja') return hiragana > 0;
  if (lang === 'zh') return cjk > 0 && hiragana === 0;
  if (lang === 'en') return latin > text.length * 0.6 && hangul === 0 && cjk === 0;
  return false;
}

interface SearchResult {
  url: string | null;
  likes?: number;
}

/**
 * Apify 키워드 검색 액터 호출 → URL 리스트 반환.
 * 액터마다 input · output 필드명이 다르므로 여러 후보로 시도.
 */
async function searchKeywordViaApify(opts: {
  actorId: string;
  keyword: string;
  maxResults: number;
}): Promise<SearchResult[]> {
  const items = await runActorSync<Record<string, unknown>>({
    actorId: opts.actorId,
    input: {
      // 흔한 필드명 나열
      keyword: opts.keyword,
      keywords: [opts.keyword],
      searchQuery: opts.keyword,
      searchQueries: [opts.keyword],
      query: opts.keyword,
      queries: [opts.keyword],
      maxItems: opts.maxResults,
      maxResults: opts.maxResults,
      resultsLimit: opts.maxResults,
      scrapeMode: 'Keyword Search',
      searchType: 'Posts',
    },
    timeoutSecs: 240,
  });

  return items.map((item) => {
    const url =
      (item.url as string | undefined) ??
      (item.postUrl as string | undefined) ??
      (item.permalink as string | undefined) ??
      (item.noteUrl as string | undefined) ??
      (item.link as string | undefined) ??
      null;

    const likes =
      toNum(item.likes) ??
      toNum(item.likeCount) ??
      toNum(item.likedCount) ??
      toNum(item.diggCount);

    return { url, likes };
  });
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

/**
 * signals가 없거나 Apify 미설정이면 idempotent skip.
 * cron에서 안전하게 호출 가능.
 */
export async function safeRunTrendSearchIngest(
  opts: SearchIngestOptions = {},
): Promise<SearchIngestSummary | null> {
  if (!isApifyConfigured()) {
    logger.info('APIFY_API_TOKEN 미설정 → 트렌드 검색 skip');
    return null;
  }
  try {
    return await runTrendSearchIngest(opts);
  } catch (err) {
    logger.error({ err }, 'trend search orchestrator failed');
    return null;
  }
}
