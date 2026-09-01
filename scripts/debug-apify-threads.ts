import 'dotenv/config';
import { runActorSync } from '../src/infra/apify-client.js';

const URL = process.argv[2] ?? 'https://www.threads.com/@yuji.ni1122/post/DcsmMV5kQ6N';

async function main() {
  const items = await runActorSync<Record<string, unknown>>({
    actorId: 'themineworks/threads-scraper',
    input: {
      mode: 'post',
      postUrls: [URL],
      maxPosts: 1,
      includeReplies: false,
      includeReposts: false,
      proxyConfiguration: { useApifyProxy: true },
    },
    timeoutSecs: 120,
  });

  console.log(`\n=== Raw items (${items.length}) ===\n`);
  items.forEach((item, i) => {
    console.log(`--- item[${i}] keys ---`);
    console.log(Object.keys(item).sort().join(', '));
    console.log(`\n--- item[${i}] full ---`);
    console.log(JSON.stringify(item, null, 2));
    console.log('\n');
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
