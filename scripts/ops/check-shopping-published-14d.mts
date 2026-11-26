import { prisma } from '../../src/db/prisma.js';
const since = new Date(Date.now() - 14 * 864e5);

// 실제 발행된 쇼핑 2주 전체
const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PUBLISHED', publishedAt: { gte: since } },
  select: { publishedAt: true, account: { select: { handle: true } } },
  orderBy: { publishedAt: 'asc' },
});

console.log(`최근 14일 쇼핑 PUBLISHED: ${posts.length}건\n`);

const byAcct: Record<string, string[]> = {};
for (const p of posts) {
  const day = p.publishedAt!.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
  (byAcct[p.account.handle] ??= []).push(day);
}

for (const [h, days] of Object.entries(byAcct)) {
  console.log(`@${h}: ${days.join(', ')}`);
  const sorted = [...new Set(days)].sort();
  for (let i = 1; i < sorted.length; i++) {
    const [m1, d1] = sorted[i-1]!.split('.').map(s => parseInt(s));
    const [m2, d2] = sorted[i]!.split('.').map(s => parseInt(s));
    const date1 = new Date(2026, m1!-1, d1!);
    const date2 = new Date(2026, m2!-1, d2!);
    const diff = (date2.getTime() - date1.getTime()) / 864e5;
    if (diff < 2 && h !== 'pikkseetem') console.log(`  ⚠️ ${sorted[i-1]} → ${sorted[i]} (${diff}일)`);
    if (diff === 1 && h === 'pikkseetem') console.log(`  ℹ️ pikk 매일 OK: ${sorted[i-1]} → ${sorted[i]}`);
  }
}

await prisma.$disconnect();
