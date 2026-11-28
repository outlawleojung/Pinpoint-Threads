import { prisma } from '../../src/db/prisma.js';
const since = new Date(Date.now() - 7 * 864e5);
const posts = await prisma.post.findMany({
  where: {
    kind: 'SHARING',
    publishedAt: { gte: since },
  },
  orderBy: { publishedAt: 'desc' },
  take: 40,
  select: { id: true, generatedBody: true, publishedAt: true, account: { select: { handle: true } } },
});
console.log(`최근 7일 발행된 스하리: ${posts.length}건\n`);
for (const p of posts) {
  const d = p.publishedAt!.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`${d} @${p.account.handle.padEnd(14)} "${p.generatedBody}"`);
}
await prisma.$disconnect();
