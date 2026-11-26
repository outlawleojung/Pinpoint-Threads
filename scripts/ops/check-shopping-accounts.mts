import { prisma } from '../../src/db/prisma.js';

const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true, audienceGender: true, followersCount: true },
  orderBy: { handle: 'asc' },
});

for (const a of accounts) {
  // 최근 7일 쇼핑 포스트 수
  const since = new Date(Date.now() - 7 * 86400000);
  const shopCount = await prisma.post.count({
    where: { accountId: a.id, kind: 'SHOPPING', createdAt: { gte: since }, state: { notIn: ['REJECTED', 'FAILED'] } },
  });
  console.log(`${a.handle.padEnd(16)} | gender: ${(a.audienceGender ?? 'null').padEnd(8)} | followers: ${String(a.followersCount ?? 0).padEnd(5)} | 최근7일 쇼핑: ${shopCount}건`);
}
await prisma.$disconnect();
