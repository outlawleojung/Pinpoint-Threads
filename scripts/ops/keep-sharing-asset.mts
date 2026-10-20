import { fetchThreadsPostRelay } from '../../src/infra/threads-relay.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';
import { uploadFromUrl } from '../../src/infra/cloudinary-client.js';
// 스하리 첨부 보관: 출처 하나씩 연달아 업로드(같은 출처 묶음) · 영상 1개면 정지 장면 이미지 추가
for (const url of process.argv.slice(2)) {
  const code = url.split('/post/')[1]!.split(/[/?]/)[0]!;
  const r: any = await fetchThreadsPostRelay(url, code);
  const media = (r?.media ?? []).slice(0, 4);
  const out: string[] = [];
  for (const m of media) out.push((await uploadFromUrl({ sourceUrl: m.url, folder: `pinpoint-threads/sharing-assets/${code}`, resourceType: m.kind === 'video' ? 'video' : 'image' })).publicUrl);
  if (out.length === 1 && media[0]?.kind === 'video') {
    const poster = out[0]!.replace('/video/upload/', '/video/upload/w_720,q_auto,so_40p/').replace(/\.mp4$/, '.jpg');
    out.push((await uploadFromUrl({ sourceUrl: poster, folder: `pinpoint-threads/sharing-assets/${code}`, resourceType: 'image' })).publicUrl);
  }
  console.log('KEEP', url.split('@')[1]?.split('/')[0], `l${r?.likes} c${r?.replies}`, media.map((m: any) => m.kind).join(','), out.map((u) => u.split('/').pop()).join(' '), '|', (r?.text ?? '').replace(/\s+/g, ' ').slice(0, 60));
}
await shutdownPlaywrightBrowser(); process.exit(0);
