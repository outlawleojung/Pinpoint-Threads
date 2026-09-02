import 'dotenv/config';
import { runActorSync } from '../src/infra/apify-client.js';
import { env } from '../src/config/env.js';

async function main() {
  const url = process.argv[2] ?? 'https://www.threads.com/@mon.i1l/post/DctUf-9Gt2N?hl=ko';
  const items = await runActorSync<Record<string, unknown>>({
    actorId: env.APIFY_ACTOR_THREADS_URL!,
    input: {
      mode: 'post',
      postUrls: [url],
      maxPosts: 1,
      includeReplies: false,
      includeReposts: false,
      proxyConfiguration: { useApifyProxy: true },
    },
    timeoutSecs: 120,
  });

  for (const item of items) {
    if ((item as any)._type === 'info') continue;
    console.log(JSON.stringify(item, null, 2));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
