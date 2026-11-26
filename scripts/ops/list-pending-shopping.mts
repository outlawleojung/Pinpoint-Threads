import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
for (const p of posts) {
  console.log(`@${p.account.handle.padEnd(16)} id=${p.id}  ${(p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 60)}`);
}
console.log(`\n총: ${posts.length}건`);
await prisma.$disconnect();
