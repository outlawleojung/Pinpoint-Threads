import { prisma } from '../../src/db/prisma.js';

// 최근 3일 일상글
const since = new Date(Date.now() - 3 * 86400000);
const posts = await prisma.post.findMany({
  where: { kind: 'DAILY', createdAt: { gte: since } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
  take: 20,
});

for (const p of posts) {
  const d = p.createdAt.toISOString().slice(0, 16);
  console.log(`${d} | ${p.account.handle.padEnd(16)} | ${p.state.padEnd(18)} | ${(p.generatedBody ?? '').slice(0, 60).replace(/\n/g, ' ')}`);
}
console.log(`\n총 ${posts.length}건`);
await prisma.$disconnect();
