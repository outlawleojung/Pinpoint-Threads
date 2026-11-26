import { prisma } from '../../src/db/prisma.js';

const recent = await prisma.post.findMany({
  where: { kind: 'SHARING', createdAt: { gte: new Date(Date.now() - 3 * 864e5) } },
  orderBy: { createdAt: 'desc' },
  take: 20,
  select: {
    id: true,
    createdAt: true,
    generatedBody: true,
    state: true,
    account: { select: { handle: true } },
  },
});

for (const p of recent) {
  const d = p.createdAt.toISOString().slice(5, 16);
  const body = (p.generatedBody ?? '(없음)').replace(/\n/g, ' / ').slice(0, 100);
  console.log(`[${d}] ${p.state.padEnd(18)} @${p.account.handle.padEnd(16)} ${body}`);
}
console.log(`\ntotal: ${recent.length}`);
await prisma.$disconnect();
