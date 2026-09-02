import { chromium } from 'playwright';

/**
 * Threads 게시글에서 비디오 URL(mp4) 추출 실 테스트.
 * 방식:
 *   1) 익명 Chromium 으로 URL 열기 (로그인 X)
 *   2) 네트워크 요청 관찰 → .mp4 URL 캡처
 *   3) DOM 렌더 후 <video src> 확인
 */
async function main() {
  const url = process.argv[2] ?? 'https://www.threads.net/@mon.i1l/post/DctUf-9Gt2N';
  console.log(`Fetching: ${url}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();

  const capturedMp4: string[] = [];
  const capturedMedia: string[] = [];
  page.on('response', (resp) => {
    const u = resp.url();
    if (u.includes('.mp4')) capturedMp4.push(u);
    if (u.match(/scontent[^/]*\.cdninstagram\.com/) && (u.includes('.jpg') || u.includes('.mp4'))) {
      capturedMedia.push(u);
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // JS 렌더 및 미디어 로드 대기
    await page.waitForTimeout(6000);

    // <video> 태그 탐색
    const videoSrcs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('video')).map((v) => ({
        src: v.src || v.currentSrc,
        poster: v.poster,
        outerHTML: v.outerHTML.slice(0, 300),
      }));
    });

    console.log(`\n=== <video> 태그 (${videoSrcs.length}개) ===`);
    videoSrcs.forEach((v, i) => {
      console.log(`  [${i}] src: ${v.src?.slice(0, 200)}`);
      console.log(`      poster: ${v.poster?.slice(0, 200)}`);
    });

    console.log(`\n=== .mp4 네트워크 요청 (${capturedMp4.length}개) ===`);
    Array.from(new Set(capturedMp4)).slice(0, 10).forEach((u, i) => {
      console.log(`  [${i}] ${u.slice(0, 200)}`);
    });

    console.log(`\n=== IG CDN 요청 총 (${capturedMedia.length}개, 중복 제거 후 상위 5) ===`);
    Array.from(new Set(capturedMedia)).slice(0, 5).forEach((u, i) => {
      console.log(`  [${i}] ${u.slice(0, 200)}`);
    });
  } catch (err) {
    console.error('실패:', (err as Error).message);
  } finally {
    await browser.close();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
