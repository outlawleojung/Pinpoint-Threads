// pikkseetem 가족 노출 바디 REJECT + pikkseetem만 재생성
import { prisma } from '../../src/db/prisma.js';
import { runSharingPipeline } from '../../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

const BAD_ID = 'cmx0jurl600078ck2kye5j9xc';

const bad = await prisma.post.findUnique({
  where: { id: BAD_ID },
  select: { state: true, generatedBody: true, account: { select: { id: true, handle: true } } },
});
if (!bad) { console.log('NOT FOUND'); process.exit(1); }

console.log(`REJECT @${bad.account.handle} [${bad.state}] "${bad.generatedBody}"`);
await prisma.post.update({
  where: { id: BAD_ID },
  data: { state: 'REJECTED', rejectionReason: '가족 노출(애 등원) — 2026-11-29 룰 강화 후 재생성' },
});

console.log('\n재생성 중...');
const result = await runSharingPipeline({ accountId: bad.account.id, variantCount: 2 });
console.log(`status: ${result.status}`);
if (result.reason) console.log(`reason: ${result.reason}`);
if (result.postId) {
  const fresh = await prisma.post.findUnique({
    where: { id: result.postId },
    select: { generatedBody: true, scheduledAt: true },
  });
  console.log(`\n@${bad.account.handle} 새 바디:`);
  console.log(fresh?.generatedBody);
}
process.exit(0);
