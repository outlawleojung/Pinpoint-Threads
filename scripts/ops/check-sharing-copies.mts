import { prisma } from '../../src/db/prisma.js';

// 최근 스하리 글 카피 확인
const posts = await prisma.post.findMany({
  where: { kind: 'SHARING' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
  take: 15,
});

for (const p of posts) {
  const d = p.createdAt.toISOString().slice(0, 10);
  console.log(`${d} | ${p.account.handle.padEnd(16)} | ${p.state.padEnd(12)} | ${(p.generatedBody ?? '').slice(0, 80).replace(/\n/g, ' ')}`);
}
console.log(`\n총 ${posts.length}건`);
await prisma.$disconnect();
