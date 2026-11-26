import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const posts = await prisma.post.findMany({
  where: { kind: 'DAILY', state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

console.log(`일상글 PENDING: ${posts.length}건 — 카드 발송 시작`);

for (const p of posts) {
  try {
    await sendApprovalRequest(p.id);
    console.log(`📨 ${p.account.handle} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
    // 텔레그램 rate limit 방지
    await new Promise(r => setTimeout(r, 2000));
  } catch (err) {
    console.log(`❌ ${p.account.handle} | ${(err as Error).message.slice(0, 60)}`);
  }
}

console.log('\n✅ 일상글 카드 발송 완료');
await prisma.$disconnect();
