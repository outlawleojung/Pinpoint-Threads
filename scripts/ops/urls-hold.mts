import { prisma } from '../../src/db/prisma.js';
import { runPipelineC } from '../../src/modules/pipeline-c/orchestrator.js';
import { judge, pickAccount } from '../../src/modules/pipeline-c/source-watch.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';
// 사용자 URL 묶음 → 글 생성(카드 보류) + ①② 후보. 카드는 프레임 직접 확인 후 별도 발송.
const items: [string, string][] = JSON.parse(process.argv[2]!);
for (const [url, desc] of items) {
  const t = Date.now();
  const acc = (await pickAccount())!;
  try {
    const out: any = await runPipelineC({ accountId: acc.id, sourceUrl: url, holdApproval: true, bodyOverride: '' });
    if (!out.postId) { console.log('FAIL', url, out.stage, out.reason); continue; }
    const post = await prisma.post.findUniqueOrThrow({ where: { id: out.postId } });
    const code = url.split('/post/')[1]?.split(/[/?]/)[0] ?? '___';
    const inbound = await prisma.inboundLink.findFirst({ where: { url: { contains: code } }, select: { rawText: true, rawLanguage: true } });
    const video = post.mediaUrls.find((u) => u.includes('/video/upload/'));
    if (!video) { console.log('NOVIDEO', acc.handle, out.postId, url, `m${post.mediaUrls.length}`); continue; }
    const j = await judge(`${inbound?.rawText ?? ''}\n(사용자 설명: ${desc})`, video);
    await prisma.post.update({
      where: { id: out.postId },
      data: { generatedBody: j.candidates[0] ?? '', sourceBrief: { ...((post.sourceBrief as object) ?? {}), rationale: { situation: j.situation ?? null }, altBodies: j.candidates } as never },
    });
    console.log('HOLD', acc.handle, out.postId, video, JSON.stringify(j.candidates), j.skip ? `⚠${j.reason}` : '', `${Math.round((Date.now() - t) / 1000)}s`, '| cap:', (inbound?.rawText ?? '').replace(/\s+/g, ' ').slice(0, 80), '| sit:', j.situation);
  } catch (e) { console.log('ERR', url, (e as Error).message.slice(0, 160)); }
}
await shutdownPlaywrightBrowser(); await prisma.$disconnect(); process.exit(0);
