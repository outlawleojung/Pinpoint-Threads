import { prisma } from '../../src/db/prisma.js';

// 최근 24h에 생성된 모든 포스트
const since = new Date(Date.now() - 24 * 3600000);
const posts = await prisma.post.findMany({
  where: { createdAt: { gte: since } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
console.log(`=== 최근 24h 포스트 전체: ${posts.length}건 ===`);
for (const p of posts) {
  const created = p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(p.kind.padEnd(10), p.state.padEnd(18), p.account.handle.padEnd(16), created, (p.generatedBody ?? '').slice(0,40).replace(/\n/g,' '));
}

// sourceItem에서 collectedAt 기준
const sources = await prisma.sourceItem.findMany({
  where: { collectedAt: { gte: since } },
  orderBy: { collectedAt: 'desc' },
  take: 20,
});
console.log(`\n=== 최근 24h 소스아이템: ${sources.length}건 ===`);
for (const s of sources) {
  const col = s.collectedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(col, s.sourceUrl?.slice(0,80) ?? '-');
}

await prisma.$disconnect();
