import { prisma } from '../../src/db/prisma.js';

const acc = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });
console.log(`minyoung.jung: ${acc.id}`);
console.log(`  isActive: ${acc.isActive}`);
console.log(`  audienceGender: ${acc.audienceGender}`);
console.log(`  followersCount: ${acc.followersCount}`);

// 최근 7일 minyoung.jung 전체 쇼핑 (all states)
const since = new Date(Date.now() - 7 * 864e5);
const posts = await prisma.post.findMany({
  where: { accountId: acc.id, kind: 'SHOPPING', createdAt: { gte: since } },
  select: {
    id: true, state: true, createdAt: true, scheduledAt: true, publishedAt: true,
    rejectionReason: true,
  },
  orderBy: { createdAt: 'desc' },
});
console.log(`\n최근 7일 쇼핑: ${posts.length}건`);
for (const p of posts) {
  console.log(`  ${p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} [${p.state}]`);
  if (p.rejectionReason) console.log(`    reason: ${(p.rejectionReason as string).slice(0, 100)}`);
}

// 최근 shopping-publisher 로그 체크 — 벤치마크 pool 상태
const bench = await prisma.post.findMany({
  where: {
    kind: 'SHARING',  // 쇼핑 벤치마크는 외부 소스
  },
  take: 3,
  orderBy: { createdAt: 'desc' },
  select: { kind: true, createdAt: true },
});

// InboundLink status 체크
const inbound = await prisma.inboundLink.findMany({
  where: {
    createdAt: { gte: since },
    status: 'PENDING',
  },
  select: { url: true, status: true, createdAt: true },
  take: 10,
  orderBy: { createdAt: 'desc' },
});
console.log(`\n최근 7일 PENDING inbound: ${inbound.length}건`);
for (const i of inbound) console.log(`  ${i.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ${i.url.slice(0, 60)}`);

await prisma.$disconnect();
