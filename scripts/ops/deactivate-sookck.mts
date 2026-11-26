import { prisma } from '../../src/db/prisma.js';

const result = await prisma.account.updateMany({
  where: { handle: 'sookck.kate' },
  data: { isActive: false },
});
console.log(`sookck.kate isActive → false (${result.count}건)`);

// 남은 APPROVED/PENDING 포스트 확인
const remaining = await prisma.post.findMany({
  where: { account: { handle: 'sookck.kate' }, state: { in: ['APPROVED', 'PENDING_APPROVAL'] } },
  select: { id: true, kind: true, state: true },
});
console.log(`남은 포스트: ${remaining.length}건`);
for (const p of remaining) console.log(`  ${p.id} ${p.kind} ${p.state}`);

await prisma.$disconnect();
