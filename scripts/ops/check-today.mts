import { prisma } from '../../src/db/prisma.js';
const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  include: { account: { select: { handle: true } } },
  orderBy: { scheduledAt: 'asc' },
});
for (const p of posts) {
  const t = p.scheduledAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  console.log(`${p.account.handle} | ${t} | ${p.generatedBody?.slice(0, 35)}`);
}
await prisma.$disconnect();
