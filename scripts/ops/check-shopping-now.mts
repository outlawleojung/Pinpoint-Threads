import { prisma } from '../../src/db/prisma.js';
const today = new Date(); today.setHours(0, 0, 0, 0);
const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', createdAt: { gte: today } },
  include: { account: { select: { handle: true } }, sourceItem: { select: { sourceUrl: true } } },
  orderBy: { createdAt: 'asc' },
});
for (const p of posts) {
  console.log(
    p.account.handle.padEnd(16),
    p.state.padEnd(18),
    (p.sourceItem?.sourceUrl ?? '').slice(-15),
    (p.generatedBody ?? '').slice(0, 60).replace(/\n/g, ' '),
  );
}
console.log(`\n총 ${posts.length}건`);
await prisma.$disconnect();
