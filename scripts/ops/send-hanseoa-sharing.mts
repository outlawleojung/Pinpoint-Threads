// hanseoa.pick 스하리 카드 1건 발송 (새 LLM 로직)
import { prisma } from '../../src/db/prisma.js';
import { runSharingPipeline } from '../../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

const acc = await prisma.account.findFirstOrThrow({ where: { handle: 'hanseoa.pick' } });

// 상태 미리보기
const recent = await prisma.post.findMany({
  where: { accountId: acc.id, kind: 'SHARING' },
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { id: true, state: true, generatedBody: true, createdAt: true },
});
console.log('최근 hanseoa SHARING 5건:');
for (const p of recent) {
  const d = p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`  ${d} [${p.state}] "${p.generatedBody}"`);
}

console.log('\n── 새 카드 발송 ──');
const r = await runSharingPipeline({ accountId: acc.id, variantCount: 2 });
console.log(`status: ${r.status}`);
if (r.reason) console.log(`reason: ${r.reason}`);
if (r.postId) {
  const fresh = await prisma.post.findUnique({
    where: { id: r.postId },
    select: { generatedBody: true, telegramMessageId: true, sourceBrief: true },
  });
  console.log(`postId: ${r.postId}`);
  console.log(`tg msg: ${fresh?.telegramMessageId}`);
  console.log(`body:\n${fresh?.generatedBody}`);
  const alts = (fresh?.sourceBrief as { altBodies?: string[] } | null)?.altBodies;
  if (alts) console.log(`\nalt:\n${alts.join('\n---\n')}`);
}
process.exit(0);
