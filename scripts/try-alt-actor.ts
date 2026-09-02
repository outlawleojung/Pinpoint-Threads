import 'dotenv/config';
import { runActorSync } from '../src/infra/apify-client.js';

/**
 * 대체 Apify actor 로 Threads 게시글 fetch 시도.
 * 목적: 비디오 URL(mp4) 을 반환하는 액터 찾기.
 */
async function main() {
  const actorId = process.argv[2];
  const url = process.argv[3] ?? 'https://www.threads.com/@mon.i1l/post/DctUf-9Gt2N?hl=ko';
  if (!actorId) {
    console.error('Usage: npx tsx scripts/try-alt-actor.ts <actorId> [url]');
    process.exit(1);
  }
  console.log(`Actor: ${actorId}\nURL: ${url}\n`);

  // 대부분 IG/Threads actor 는 아래 인풋 중 하나를 지원
  const input = {
    postUrls: [url],
    directUrls: [url],
    urls: [url],
    startUrls: [{ url }],
    postURLs: [url],
    resultsLimit: 1,
    resultsPerPage: 1,
    maxItems: 1,
    proxyConfiguration: { useApifyProxy: true },
  };

  try {
    const items = await runActorSync<Record<string, unknown>>({
      actorId,
      input,
      timeoutSecs: 180,
    });
    console.log(`Items: ${items.length}\n`);
    for (const item of items) {
      if ((item as any)._type === 'info') continue;
      // video 관련 키만 발췌 + 미디어 배열 요약
      const keys = Object.keys(item);
      console.log(`--- item keys: ${keys.length} ---`);
      const videoKeys = keys.filter((k) => /video|mp4|url/i.test(k));
      for (const k of videoKeys) {
        console.log(`  ${k}: ${JSON.stringify(item[k]).slice(0, 200)}`);
      }
      // 미디어 배열 존재 여부
      for (const arrayKey of ['media', 'mediaUrls', 'media_urls', 'carouselMedia', 'images', 'videos']) {
        if (Array.isArray(item[arrayKey])) {
          console.log(`  ${arrayKey}[${(item[arrayKey] as unknown[]).length}]:`);
          for (const m of item[arrayKey] as unknown[]) {
            if (typeof m === 'string') console.log(`    - ${m.slice(0, 150)}`);
            else console.log(`    - ${JSON.stringify(m).slice(0, 250)}`);
          }
        }
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('실패:', (err as Error).message);
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
