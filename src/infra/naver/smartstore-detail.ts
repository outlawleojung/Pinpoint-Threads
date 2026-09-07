import { chromium } from 'playwright';
import { logger } from '../../config/logger.js';

/** 축약/트래킹 링크 → 최종 URL (리다이렉트 추적, HEAD 우선 GET 폴백). */
export async function resolveConnectUrl(connectUrl: string): Promise<string> {
  try {
    const resp = await fetch(connectUrl, { redirect: 'follow', method: 'GET' });
    return resp.url || connectUrl;
  } catch (err) {
    logger.warn({ err: (err as Error).message, connectUrl }, 'resolveConnectUrl 실패, 원본 사용');
    return connectUrl;
  }
}

/** 상세페이지 대표/상세 이미지 URL 취득. 실패 시 빈 배열(호출측이 쇼핑검색 썸네일로 폴백). */
export async function fetchProductImages(productUrl: string, opts?: { max?: number }): Promise<string[]> {
  const max = opts?.max ?? 8;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    // 스마트스토어 상품 이미지: pstatic.net 도메인 img src 수집.
    const urls = await page.evaluate(() => {
      const set = new Set<string>();
      const doc = (globalThis as unknown as { document: any }).document;
      doc.querySelectorAll('img').forEach((img: any) => {
        const src = img.src as string;
        if (src && /pstatic\.net|phinf|shop-phinf/.test(src)) set.add(src.split('?')[0]!);
      });
      return Array.from(set) as string[];
    });
    return urls.slice(0, max);
  } catch (err) {
    logger.warn({ err: (err as Error).message, productUrl }, 'fetchProductImages 실패');
    return [];
  } finally {
    await browser?.close();
  }
}
