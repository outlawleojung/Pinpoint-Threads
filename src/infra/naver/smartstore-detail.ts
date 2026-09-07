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
    await browser?.close().catch(() => {});
  }
}

/** 상품명 + 이미지 URL을 상세페이지에서 함께 취득. 실패 시 { name: null, images: [] } (호출측이 제목 추측으로 폴백). */
export async function fetchProductInfo(
  productUrl: string,
  opts?: { maxImages?: number },
): Promise<{ name: string | null; images: string[] }> {
  const maxImages = opts?.maxImages ?? 6;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30_000 });

    // 참고: page.evaluate로 넘긴 클로저는 Playwright가 toString()으로 문자열화해 브라우저 컨텍스트에서 재평가한다.
    // 이 과정에서 esbuild/tsx가 삽입하는 __name 같은 모듈 스코프 헬퍼는 함께 넘어가지 않으므로,
    // 클로저 내부에 이름 있는 const 함수(예: `const pick = (sel) => {...}`)를 두면 ReferenceError가 난다.
    // 그래서 별도 헬퍼 없이 셀렉터 배열을 for 루프로 직접 순회한다.
    const result = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: any }).document;

      // 스마트스토어/브랜드스토어 상품명 셀렉터 후보 → og:title → document.title 순 폴백.
      const titleSelectors = [
        'h3._22kNQuEXmp', // 스마트스토어 구 마크업
        '[class*="product_title"]',
        '[class*="_1eddO85Io3"]',
        'h3[class*="title"]',
      ];
      let name = '';
      for (const sel of titleSelectors) {
        const el = doc.querySelector(sel);
        const text = typeof el?.textContent === 'string' ? el.textContent.trim() : '';
        if (text.length > 0) {
          name = text;
          break;
        }
      }
      if (name.length === 0) {
        const og = doc.querySelector('meta[property="og:title"]');
        const ogText = typeof og?.content === 'string' ? og.content.trim() : '';
        if (ogText.length > 0) name = ogText;
      }
      if (name.length === 0 && typeof doc.title === 'string') {
        name = doc.title.trim();
      }

      const set = new Set<string>();
      doc.querySelectorAll('img').forEach((img: any) => {
        const src = img.src as string;
        if (src && /pstatic\.net|phinf|shop-phinf/.test(src)) set.add(src.split('?')[0]!);
      });

      return { name, images: Array.from(set) as string[] };
    });

    return {
      name: result.name.length > 0 ? result.name : null,
      images: result.images.slice(0, maxImages),
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, productUrl }, 'fetchProductInfo 실패');
    return { name: null, images: [] };
  } finally {
    await browser?.close().catch(() => {});
  }
}
