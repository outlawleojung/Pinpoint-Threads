import { prisma } from '../../src/db/prisma.js';

// 모든 state의 DAILY 포스트 (최근 3일)
const since = new Date(Date.now() - 3 * 86400000);
const posts = await prisma.post.findMany({
  where: { kind: 'DAILY', createdAt: { gte: since } },
  include: { account: { select: { handle: true } }, sourceItem: { select: { sourceUrl: true } } },
  orderBy: { createdAt: 'desc' },
});
console.log(`=== 최근 3일 DAILY 전체: ${posts.length}건 ===`);
for (const p of posts) {
  const created = p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(p.state.padEnd(18), p.account.handle.padEnd(16), created, p.sourceItem?.sourceUrl?.slice(0,60) ?? '-');
}

// PENDING_APPROVAL 모든 종류
const pending = await prisma.post.findMany({
  where: { state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
console.log(`\n=== PENDING_APPROVAL 전체 (종류 무관): ${pending.length}건 ===`);
for (const p of pending) {
  const created = p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(p.kind.padEnd(10), p.state.padEnd(18), p.account.handle.padEnd(16), created);
}

// 소스아이템 중 최근에 들어온 것 (텔레그램 인제스트)
const sources = await prisma.sourceItem.findMany({
  where: { createdAt: { gte: new Date(Date.now() - 86400000) } },
  orderBy: { createdAt: 'desc' },
  take: 10,
});
console.log(`\n=== 최근 24h 소스아이템: ${sources.length}건 ===`);
for (const s of sources) {
  const created = s.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(created, s.sourceUrl?.slice(0,80) ?? '-');
}

await prisma.$disconnect();
