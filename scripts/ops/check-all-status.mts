import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { createdAt: { gte: new Date(Date.now() - 86400000 * 2) } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

for (const p of posts) {
  const sched = p.scheduledAt
    ? p.scheduledAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    : '-';
  console.log(
    p.state.padEnd(18),
    p.account.handle.padEnd(16),
    p.kind.padEnd(10),
    sched.padEnd(24),
    (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 55),
  );
}

console.log(`\n총 ${posts.length}건`);
const byState = posts.reduce((m, p) => { m[p.state] = (m[p.state] ?? 0) + 1; return m; }, {} as Record<string, number>);
for (const [s, c] of Object.entries(byState)) console.log(`  ${s}: ${c}`);

await prisma.$disconnect();
