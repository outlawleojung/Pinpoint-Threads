import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { kind: 'SHARING', state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  select: { generatedBody: true, state: true, createdAt: true, account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
for (const p of posts) {
  const body = (p.generatedBody ?? '').replace(/\n/g, ' / ');
  console.log(`[${p.state}] @${p.account.handle.padEnd(16)} "${body}"`);
}
console.log(`\n총: ${posts.length}건`);
await prisma.$disconnect();
