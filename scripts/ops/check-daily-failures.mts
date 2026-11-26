import { prisma } from '../../src/db/prisma.js';

const since = new Date(Date.now() - 3 * 86400000);
const failed = await prisma.post.findMany({
  where: { kind: 'DAILY', state: { in: ['FAILED'] }, createdAt: { gte: since } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
  take: 10,
});

for (const p of failed) {
  console.log(`${p.createdAt.toISOString().slice(0,16)} | ${p.account.handle} | ${p.rejectionReason ?? 'no reason'}`);
}
console.log(`\n실패 ${failed.length}건`);
await prisma.$disconnect();
