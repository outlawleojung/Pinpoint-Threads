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
/**
 * Threads URL 에서 shortcode 추출 (/post/{shortcode}).
 */
function extractShortcode(url: string): string | null {
  const m = url.match(/\/post\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

export async function extractThreadsVideoUrls(url: string): Promise<ThreadsVideoExtractResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();

  // 페이지엔 target 게시글 + 추천글 수십 개가 함께 렌더됨.
  // 각 <video> 의 부모 [role="link"] 의 permalink 에서 shortcode 를 비교해
  // **target 게시글 비디오만** 정확히 골라냄 (추천글 오염 방지).
  const shortcode = extractShortcode(url);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // JS 렌더 + 미디어 로드 대기
    await page.waitForTimeout(6000);

    const videoSrcs: string[] = await page.evaluate((sc: string | null) => {
      const out: string[] = [];
      // @ts-expect-error - browser context (document 는 페이지 컨텍스트에 존재)
      document.querySelectorAll('video').forEach((v: any) => {
        const src = v.src || v.currentSrc;
        if (!src || !src.includes('.mp4')) return;
        // 이 video 를 감싼 게시글 컨테이너의 permalink
        const post = v.closest('[role="link"], article, [data-pressable-container]');
        const permalink = post?.querySelector('a[href*="/post/"]')?.getAttribute('href') ?? null;
        // shortcode 매칭되는 것만 (매칭 불가 시 sc 없으면 전체 통과)
        if (!sc || (permalink && permalink.includes(sc))) {
          out.push(src);
        }
      });
      return out;
    }, shortcode);

    const capturedMp4 = new Set<string>(videoSrcs);
    logger.info(
      { url, shortcode, mp4Count: capturedMp4.size },
      'threads video extract done (shortcode-matched)',
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

/**
 * Threads /share/ 단축 URL → 실제 게시글 URL(@user/post/id) 해석.
 * JS 클라이언트 렌더라 fetch 로는 안 되고 브라우저 필요. 실패 시 null.
 */
export async function resolveThreadsShareUrl(shareUrl: string): Promise<string | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    locale: 'ko-KR',
  });
  const page = await context.newPage();
  try {
    await page.goto(shareUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    const result = await page.evaluate(() => {
      // @ts-expect-error - browser context
      const og = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
      // @ts-expect-error - browser context
      const loc = location.href;
      return { og, loc };
    });
    // og:url 우선 (트래킹 파라미터 없는 깔끔한 형태), 없으면 현재 위치
    const candidate = (result.og && /\/@[^/]+\/post\//i.test(result.og))
      ? result.og
      : (/\/@[^/]+\/post\//i.test(result.loc) ? result.loc : null);
    if (!candidate) return null;
    // 트래킹 파라미터 제거
    try {
      const u = new URL(candidate);
      return `${u.origin}${u.pathname}`;
    } catch {
      return candidate;
    }
  } catch (err) {
    logger.warn({ err, shareUrl }, 'resolveThreadsShareUrl failed');
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}
