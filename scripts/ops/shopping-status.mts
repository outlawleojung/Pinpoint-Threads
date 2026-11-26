import { prisma } from '../../src/db/prisma.js';

const accounts = await prisma.account.findMany({
  where: { handle: { in: ['pikkseetem', 'sookck.kate'] }, isActive: true },
  select: { id: true, handle: true, followersCount: true },
});

for (const a of accounts) {
  const last = await prisma.post.findFirst({
    where: { accountId: a.id, kind: 'SHOPPING', state: { notIn: ['REJECTED', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, state: true },
  });
  const hrs = last ? Math.round((Date.now() - last.createdAt.getTime()) / 3600000) : null;
  console.log(a.handle, '|', a.followersCount, 'followers |', hrs !== null ? `${hrs}h ago (${last!.state})` : 'no shopping');
}

const links = await prisma.inboundLink.findMany({
  orderBy: { createdAt: 'desc' },
  take: 10,
  select: { id: true, url: true, manualProductName: true, manualCommerceUrl: true, createdAt: true, status: true },
});
console.log('\n=== 최근 inboundLink ===');
for (const l of links) {
  console.log(`${l.id.slice(-8)} | ${l.status} | ${l.createdAt.toISOString().slice(0, 10)} | ${(l.manualProductName ?? l.url ?? '?').slice(0, 60)}`);
}

await prisma.$disconnect();
