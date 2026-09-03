import { chromium, type Browser } from 'playwright';
import { logger } from '../config/logger.js';

/**
 * Threads 게시글에서 비디오 URL (mp4) 을 익명 헤드리스 Chromium 으로 추출.
 *
 * 안전 원칙:
 *   - **로그인 절대 X** (익명 방문자로만 접속 → 우리 4계정과 무관)
 *   - **우리 계정 쿠키·토큰 절대 사용 X**
 *   - **순차 실행** (동시 여러 URL 금지 · 봇 감지 회피)
 *   - **User Agent = 일반 브라우저**
 *   - **자연스러운 딜레이** (JS 렌더 + 미디어 로드 대기 6초)
 *
 * 반환: mp4 URL 배열 (중복 제거 · 화질 여러 개 있을 수 있음)
 * Threads CDN URL 은 ~10분 후 만료되므로 즉시 Cloudinary 등에 업로드 필요.
 */

// 브라우저 재사용 (셧다운은 프로세스 종료 시)
let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

export async function shutdownPlaywrightBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

export interface ThreadsVideoExtractResult {
  mp4Urls: string[]; // 발견된 mp4 URL (여러 화질 · 중복 제거)
  fetchedAt: Date;
}

/**
 * Threads 게시글 URL 에서 실 mp4 URL 을 추출.
 * 게시글이 비디오 포함 아니면 빈 배열.
 */
export async function extractThreadsVideoUrls(url: string): Promise<ThreadsVideoExtractResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();

  // 우리는 페이지 최상단 (target 게시글) 의 비디오만 원함.
  // 네트워크 캡처는 추천글까지 포함 → DOM 에서 첫 <article>·비디오 슬롯만 추출.
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // JS 렌더 + 미디어 로드 대기
    await page.waitForTimeout(6000);

    // 첫 번째 <article> 요소 내부의 <video> src 만 추출 (target 게시글)
    const videoSrcs: string[] = await page.evaluate(() => {
      // @ts-expect-error - browser context
      const article = document.querySelector('article');
      // @ts-expect-error - browser context
      const root = article ?? document;
      return Array.from(root.querySelectorAll('video'))
        .map((v: any) => v.src || v.currentSrc)
        .filter((s: string) => s && s.includes('.mp4'));
    });

    const capturedMp4 = new Set<string>(videoSrcs);
    logger.info(
      { url, mp4Count: capturedMp4.size },
      'threads video extract done (article-scoped)',
    );
    return { mp4Urls: Array.from(capturedMp4), fetchedAt: new Date() };
  } catch (err) {
    logger.warn({ err, url }, 'threads video extract failed');
    return { mp4Urls: [], fetchedAt: new Date() };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Threads 게시글에 비디오가 있으면 최적 mp4 1개만 반환.
 *
 * Threads CDN 은 같은 비디오의 여러 화질/버퍼 URL 을 다른 파일명·asset_id 로 서빙 (병렬 요청).
 * 실 캐러셀 다중 비디오 vs 단일 비디오 여러 화질 구분 신뢰 불가 → 항상 첫 URL 1개만.
 *
 * 다중 비디오 게시글은 드물고, 대부분 케이스에서 1개만 잡아도 정확 · 재발 리스크 최소.
 */
export function pickBestMp4s(urls: string[]): string[] {
  if (urls.length === 0) return [];
  return [urls[0]!];
}
