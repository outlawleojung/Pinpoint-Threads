import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const posts = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    state: 'PENDING_APPROVAL',
    accountId: { in: await prisma.account.findMany({
      where: { handle: { in: ['hanseoa.pick', 'kle0_lee'] } },
      select: { id: true },
    }).then(a => a.map(x => x.id)) },
  },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

console.log(`hanseoa.pick + kle0_lee 쇼핑 ${posts.length}건 승인 카드 전송\n`);

for (const p of posts) {
  try {
    await sendApprovalRequest(p.id);
    console.log(`✅ @${p.account.handle.padEnd(16)} ${(p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 50)}`);
  } catch (e: any) {
    console.log(`❌ @${p.account.handle.padEnd(16)} ${e.message}`);
  }
}

await prisma.$disconnect();
