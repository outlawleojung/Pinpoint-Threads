import { prisma } from '../../src/db/prisma.js';
const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { handle: true, followersCount: true },
  orderBy: { followersCount: 'desc' },
});
for (const a of accounts) {
  const cnt = a.followersCount ?? 0;
  const status = cnt >= 300 ? '✅ 쇼핑 가능' : cnt >= 250 ? '🔜 거의 도달' : `⏳ ${250 - cnt}명 부족`;
  console.log(`${a.handle.padEnd(18)} ${String(cnt).padStart(5)}명  ${status}`);
}
await prisma.$disconnect();
