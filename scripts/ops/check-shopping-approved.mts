import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  select: { id: true, scheduledAt: true, generatedBody: true, account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
for (const p of posts) {
  const sched = p.scheduledAt?.toISOString() ?? 'NULL';
  const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 50);
  console.log(`@${p.account.handle.padEnd(16)} sched=${sched.padEnd(26)} "${body}"`);
}
console.log(`\n총: ${posts.length}건`);
await prisma.$disconnect();
