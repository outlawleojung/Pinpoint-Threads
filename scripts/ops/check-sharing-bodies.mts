import { prisma } from '../../src/db/prisma.js';
const since = new Date(Date.now() - 14 * 864e5);
const posts = await prisma.post.findMany({
  where: { kind: 'SHARING', createdAt: { gte: since }, generatedBody: { not: null } },
  orderBy: { createdAt: 'desc' }, take: 30,
  select: { generatedBody: true, state: true, account: { select: { handle: true } }, createdAt: true },
});
for (const p of posts) {
  const d = p.createdAt.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
  console.log(`${d} @${p.account.handle.padEnd(14)} [${p.state.padEnd(16)}] ${p.generatedBody}`);
}
await prisma.$disconnect();
