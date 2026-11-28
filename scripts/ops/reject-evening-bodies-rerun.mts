// 아침 발행과 모순되는 저녁/밤 묘사 바디 REJECT + 재생성
import { prisma } from '../../src/db/prisma.js';
import { runSharingPipeline } from '../../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

// pikk 4274, minyoung 5(previous), kle0 3(previous) — 재조회해서 최신 PENDING 사용
const HANDLES_TO_REJECT = ['pikkseetem', 'minyoung.jung', 'kle0_lee'];

for (const handle of HANDLES_TO_REJECT) {
  const acc = await prisma.account.findFirst({ where: { handle } });
  if (!acc) continue;
  const pending = await prisma.post.findFirst({
    where: { accountId: acc.id, kind: 'SHARING', state: 'PENDING_APPROVAL' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, generatedBody: true },
  });
  if (!pending) { console.log(`@${handle}: no pending`); continue; }
  console.log(`\nREJECT @${handle}: "${pending.generatedBody?.slice(0, 80)}..."`);
  await prisma.post.update({
    where: { id: pending.id },
    data: { state: 'REJECTED', rejectionReason: '아침 발행과 모순(저녁/밤 묘사) — 2026-11-29' },
  });

  console.log(`  재생성 중...`);
  const r = await runSharingPipeline({ accountId: acc.id, variantCount: 2 });
  console.log(`  status: ${r.status}`);
  if (r.reason) console.log(`  reason: ${r.reason}`);
  if (r.postId) {
    const fresh = await prisma.post.findUnique({ where: { id: r.postId }, select: { generatedBody: true } });
    console.log(`  새 바디: ${fresh?.generatedBody}`);
  }
}
process.exit(0);
