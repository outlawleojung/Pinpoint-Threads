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

  const capturedMp4 = new Set<string>();
  page.on('response', (resp) => {
    const u = resp.url();
    if (u.includes('.mp4') && u.match(/scontent[^/]*\.cdninstagram\.com/)) {
      capturedMp4.add(u);
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // JS 렌더 + 미디어 로드 대기
    await page.waitForTimeout(6000);

    // <video src=> 도 병렬로 확인 · evaluate 는 브라우저 컨텍스트라 any 타입
    const videoSrcs: string[] = await page.evaluate(() => {
      // @ts-expect-error - browser context
      return Array.from(document.querySelectorAll('video'))
        // @ts-expect-error - browser context
        .map((v) => v.src || v.currentSrc)
        .filter((s: string) => s && s.includes('.mp4'));
    });
    for (const s of videoSrcs) capturedMp4.add(s);

    logger.info(
      { url, mp4Count: capturedMp4.size },
      'threads video extract done',
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
 * Threads CDN 은 같은 비디오의 여러 화질/버퍼 URL 을 병렬로 서빙.
 * 여러 URL 이 같은 비디오의 화질 변형인지, 서로 다른 비디오인지 구분해야 함.
 *
 * 관찰: Meta CDN mp4 URL 파일명은 `<videoId>_<qualitySuffix>.mp4` 패턴.
 *   예: `AQMabc123_720p_dashinit.mp4` · `AQMabc123_360p_dashinit.mp4` (같은 videoId → dedup)
 *   반면 캐러셀의 다른 비디오는 videoId 자체가 다름.
 *
 * 전략: 파일명 앞 12자 (Meta ID prefix) 로 그룹핑, 각 그룹당 첫 URL 만 유지.
 * 캐러셀 다중 비디오 지원.
 */
export function pickBestMp4s(urls: string[]): string[] {
  if (urls.length === 0) return [];
  const seen = new Set<string>();
  const picks: string[] = [];
  for (const url of urls) {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').pop() ?? url;
      // Meta ID prefix: 파일명 앞 12자 (예: AQMabc123XY) — 같은 비디오의 화질 변형은 앞 12자 동일
      const key = filename.slice(0, 12);
      if (!seen.has(key)) {
        seen.add(key);
        picks.push(url);
      }
    } catch {
      if (!seen.has(url)) {
        seen.add(url);
        picks.push(url);
      }
    }
  }
  return picks;
}
