import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

console.log(`PENDING_APPROVAL 쇼핑 ${posts.length}건 카드 재발송\n`);

for (const p of posts) {
  try {
    await sendApprovalRequest(p.id);
    const body = (p.generatedBody || '').slice(0, 40).replace(/\n/g, ' ');
    console.log(`✅ ${p.account.handle.padEnd(15)} | ${body}`);
  } catch (e: any) {
    console.log(`❌ ${p.account.handle} | ${e.message}`);
  }
}

await prisma.$disconnect();
