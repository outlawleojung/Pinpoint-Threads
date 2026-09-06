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

export interface CoupangProductPage {
  title: string | null;
  images: string[]; // 상품 상세 대표 이미지 (2+ 목표), https 절대 URL
}

/**
 * 스크래핑한 원시 이미지 URL 정규화 (Node 측 — evaluate 밖에서 처리).
 *   - // → https:
 *   - 저해상 목록 썸네일(48x48 등) → 492x492 로 승격
 *   - coupang CDN + 이미지 확장자만, dedup, 최대 6개
 */
function normalizeCoupangImages(raw: string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    if (!r) continue;
    let u = r.trim();
    if (u.startsWith('//')) u = 'https:' + u;
    u = u.replace(/\/thumbnails\/remote\/\d+x\d+[^/]*\//, '/thumbnails/remote/492x492ex/');
    if (/coupangcdn\.com|coupang\.com/.test(u) && /\.(jpg|jpeg|png|webp)/i.test(u)) out.add(u);
  }
  return Array.from(out).slice(0, 6);
}

/**
 * 쿠팡 상품 페이지에서 제목 + 대표 이미지들을 한 번에 추출 (Line B 미디어 소스).
 * 한 페이지 로드로 title·images 동시 수집. 실패 시 {title:null, images:[]}.
 */
export async function fetchCoupangProductPage(url: string): Promise<CoupangProductPage> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    locale: 'ko-KR',
  });
  const page = await context.newPage();
  const isBlocked = (t: string) => /access denied|잠시 후 다시|접근이 거부/i.test(t);
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
      // 주의: page.evaluate 내부에 함수 선언(const 화살표 포함) 금지 —
      //   tsx/esbuild keepNames 가 __name 헬퍼를 주입해 브라우저에서 ReferenceError.
      //   모든 로직을 인라인으로, 원시 후보만 반환하고 정규화는 Node 쪽에서 처리.
      const result = await page.evaluate(() => {
        // @ts-expect-error - browser context
        const d = document;
        const h = d.querySelector('h1.prod-buy-header__title, h2.prod-buy-header__title');
        const og = d.querySelector('meta[property="og:title"]');
        const title = (h?.textContent || og?.getAttribute('content') || d.title || '').trim();
        const raw: string[] = [];
        const ogImg = d.querySelector('meta[property="og:image"]');
        const ogc = ogImg?.getAttribute('content');
        if (ogc) raw.push(ogc);
        const nodes = d.querySelectorAll('.prod-image__items img, img.prod-image__detail, .prod-image img');
        for (let i = 0; i < nodes.length; i++) {
          const s = nodes[i].getAttribute('src');
          const ds = nodes[i].getAttribute('data-src');
          if (s) raw.push(s);
          if (ds) raw.push(ds);
        }
        return { title, rawImages: raw };
      });
      const images = normalizeCoupangImages(result.rawImages);
      if (isBlocked(result.title) || (!result.title && images.length === 0)) {
        logger.warn({ url, attempt }, 'coupang 봇 차단/빈 페이지 · 재시도');
        await page.waitForTimeout(2000 * attempt);
        continue;
      }
      const cleaned = result.title
        ? result.title.replace(/\s*\|\s*쿠팡\s*$/i, '').replace(/\s*-\s*[^-]*$/i, '').trim()
        : null;
      const title = cleaned && cleaned.length >= 4 && !isBlocked(cleaned) ? cleaned : null;
      logger.info({ url, title: title?.slice(0, 60), imageCount: images.length }, 'coupang product page 추출');
      return { title, images };
    }
    return { title: null, images: [] };
  } catch (err) {
    logger.warn({ err, url }, 'coupang product page 추출 실패');
    return { title: null, images: [] };
  } finally {
    await context.close().catch(() => {});
  }
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
  const isBlocked = (t: string) => /access denied|잠시 후 다시|접근이 거부/i.test(t);
  try {
    // 봇 차단(Access Denied) 간헐 발생 → 최대 3회 재시도
    for (let attempt = 1; attempt <= 3; attempt++) {
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
      if (isBlocked(raw) || !raw) {
        logger.warn({ url, attempt, raw: raw.slice(0, 40) }, 'coupang 봇 차단 페이지 · 재시도');
        await page.waitForTimeout(2000 * attempt);
        continue;
      }
      // "제품명, 옵션 - 카테고리 | 쿠팡" → 제품명+옵션만
      const cleaned = raw
        .replace(/\s*\|\s*쿠팡\s*$/i, '')
        .replace(/\s*-\s*[^-]*$/i, '')
        .trim();
      if (!cleaned || cleaned.length < 4 || isBlocked(cleaned)) continue;
      logger.info({ url, title: cleaned.slice(0, 80) }, 'coupang product title 추출');
      return cleaned;
    }
    logger.warn({ url }, 'coupang title 추출 실패 (3회 차단)');
    return null;
  } catch (err) {
    logger.warn({ err, url }, 'coupang title 추출 실패');
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}
