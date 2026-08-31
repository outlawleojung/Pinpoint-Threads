import { request } from 'undici';
import { env } from '../../../../config/env.js';
import { logger } from '../../../../config/logger.js';
import { TrendSource, TrendCategory } from '@prisma/client';
import type { TrendSourceAdapter, RawTrendSignal } from '../index.js';

/**
 * 네이버 데이터랩 · 쇼핑인사이트 카테고리 트렌드 어댑터.
 *
 * 카테고리별 클릭 추이(ratio 0~100)를 지난 14일 조회 후,
 * 최근 7일 평균 vs 이전 7일 평균으로 velocity 계산.
 *
 * ratio는 상대치라 절대 클릭 수 아님. 카테고리 간 상승세 비교에 유효.
 * 키워드 단위는 별도 endpoint(category/keywords) 필요 — 이후 확장.
 *
 * API 문서: https://developers.naver.com/docs/serviceapi/datalab/shopping/shopping.md
 */

const API_URL = 'https://openapi.naver.com/v1/datalab/shopping/categories';

// 30-40대 여성 니치 커버하는 카테고리 (네이버 카테고리 코드)
const WATCHED_CATEGORIES: Array<{
  code: string;
  label: string;
  ourCategory: TrendCategory;
}> = [
  { code: '50000000', label: '패션의류', ourCategory: TrendCategory.FASHION },
  { code: '50000001', label: '패션잡화', ourCategory: TrendCategory.FASHION },
  { code: '50000002', label: '화장품/미용', ourCategory: TrendCategory.BEAUTY_SKINCARE },
  { code: '50000004', label: '가구/인테리어', ourCategory: TrendCategory.HOME },
  { code: '50000005', label: '출산/육아', ourCategory: TrendCategory.BABY_KIDS },
  { code: '50000006', label: '식품', ourCategory: TrendCategory.FOOD },
  { code: '50000008', label: '생활/건강', ourCategory: TrendCategory.HEALTH },
];

interface DatalabResponse {
  results: Array<{
    title: string;
    category: string[];
    data: Array<{ period: string; ratio: number }>;
  }>;
}

export class NaverDatalabAdapter implements TrendSourceAdapter {
  readonly source = TrendSource.NAVER_DATALAB;

  async fetchSignals(): Promise<RawTrendSignal[]> {
    if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
      logger.warn(
        'NAVER_CLIENT_ID/SECRET 미설정 → Naver DataLab 어댑터 skip. https://developers.naver.com 에서 앱 등록 후 .env에 입력.',
      );
      return [];
    }

    const endDate = todayString();
    const startDate = daysAgoString(14);

    const body = {
      startDate,
      endDate,
      timeUnit: 'date',
      category: WATCHED_CATEGORIES.map((c) => ({ name: c.label, param: [c.code] })),
    };

    const res = await request(API_URL, {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.statusCode >= 400) {
      const errBody = await res.body.text();
      throw new Error(`Naver DataLab HTTP ${res.statusCode}: ${errBody.slice(0, 300)}`);
    }

    const json = (await res.body.json()) as DatalabResponse;

    const signals: RawTrendSignal[] = [];
    for (const r of json.results) {
      const catCfg = WATCHED_CATEGORIES.find((c) => c.code === r.category[0]);
      if (!catCfg) continue;
      const data = r.data;
      if (data.length < 8) continue;

      // 최근 7일 평균 vs 그 이전 7일 평균
      const recent = data.slice(-7);
      const previous = data.slice(-14, -7);
      const recentAvg = avg(recent.map((d) => d.ratio));
      const previousAvg = avg(previous.map((d) => d.ratio));

      signals.push({
        source: this.source,
        keyword: catCfg.label,
        category: catCfg.ourCategory,
        currentValue: recentAvg,
        rawPayload: {
          categoryCode: catCfg.code,
          endDate,
          recentAvg,
          previousAvg,
          series: data,
        },
      });
    }

    logger.info(
      { fetched: signals.length, categories: signals.map((s) => s.keyword) },
      'naver datalab fetched',
    );
    return signals;
  }
}

function todayString(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function daysAgoString(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
