import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const posts = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    state: 'PENDING_APPROVAL',
    generatedBody: { contains: '헌터' },
    createdAt: { gte: new Date(Date.now() - 3600000) },
  },
  select: { id: true, account: { select: { handle: true } }, generatedBody: true },
});

console.log(`헌터 포스트: ${posts.length}건`);
for (const p of posts) {
  console.log(`  ${p.account.handle} | ${p.id.slice(-8)} | ${p.generatedBody?.slice(0, 60)}`);
  await sendApprovalRequest(p.id);
  console.log(`  📨 카드 발송 완료`);
}

await prisma.$disconnect();
