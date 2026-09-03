import { chromium, type Browser } from 'playwright';
import { logger } from '../config/logger.js';

/**
 * 쿠팡 상품 페이지에서 전체 상품 제목을 추출.
 *
 * 쿠팡은 raw fetch 를 Access Denied 로 차단하므로 headless 브라우저 사용.
 * 딥링크(link.coupang.com/a/...) 는 자동으로 상품 페이지로 리다이렉트됨.
 * 상품 제목에 핵심 특징이 다 담겨 있음 (예: "물없이 사용하는 일회용 미니칫솔 ... 5-in-1").
 *
 * 익명 · 로그인 X · 우리 계정 무관.
 */

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

/**
 * 쿠팡 URL(딥링크 or 상품 URL)에서 상품 제목 추출.
 * 실패 시 null.
 */
export async function fetchCoupangProductTitle(url: string): Promise<string | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    locale: 'ko-KR',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const raw = await page.evaluate(() => {
      // @ts-expect-error - browser context
      const h = document.querySelector('h1.prod-buy-header__title, h2.prod-buy-header__title');
      // @ts-expect-error - browser context
      const og = document.querySelector('meta[property="og:title"]');
      // @ts-expect-error - browser context
      return (h?.textContent || og?.getAttribute('content') || document.title || '').trim();
    });
    // "제품명, 옵션 - 카테고리 | 쿠팡" 형태 → 앞부분(제품명+옵션)만
    const cleaned = raw
      .replace(/\s*\|\s*쿠팡\s*$/i, '')
      .replace(/\s*-\s*[^-]*$/i, '') // 마지막 " - 카테고리" 제거
      .trim();
    if (!cleaned || cleaned.length < 4) {
      logger.warn({ url, raw }, 'coupang title 추출 실패 (빈 값)');
      return null;
    }
    logger.info({ url, title: cleaned.slice(0, 80) }, 'coupang product title 추출');
    return cleaned;
  } catch (err) {
    logger.warn({ err, url }, 'coupang title 추출 실패');
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}
