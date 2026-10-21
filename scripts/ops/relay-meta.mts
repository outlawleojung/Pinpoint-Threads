import { fetchThreadsPostRelay } from '../../src/infra/threads-relay.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';
const url = process.argv[2]!; const code = url.split('/post/')[1]!.split(/[/?]/)[0]!;
const r: any = await fetchThreadsPostRelay(url, code);
console.log('M', r?.takenAt?.toISOString?.().slice(0, 10), `l${r?.likes} c${r?.replies}`, (r?.media ?? []).map((m: any) => m.kind).join(','), '|', (r?.text ?? '').replace(/\s+/g, ' ').slice(0, 100));
await shutdownPlaywrightBrowser(); process.exit(0);
