import { prisma } from '../../src/db/prisma.js';
const since = new Date('2026-11-18T00:00:00+09:00');

const posts = await prisma.post.findMany({
  where: { kind: 'SHARING', createdAt: { gte: since } },
  select: { state: true, scheduledAt: true, publishedAt: true, createdAt: true, account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

const byAcc: Record<string, string[]> = {};
for (const p of posts) {
  const when = (p.publishedAt ?? p.scheduledAt ?? p.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
  const key = p.account.handle;
  (byAcc[key] ??= []).push(`${when}[${p.state}]`);
}
for (const [h, arr] of Object.entries(byAcc)) {
  console.log(`\n@${h} (${arr.length}건):`);
  for (const s of arr) console.log(`  ${s}`);
}

await prisma.$disconnect();
