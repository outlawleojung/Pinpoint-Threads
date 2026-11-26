import { prisma } from '../../src/db/prisma.js';

// 오늘 + 어제 DAILY 전체 (모든 state)
const since = new Date(Date.now() - 2 * 86400000);
const posts = await prisma.post.findMany({
  where: { kind: 'DAILY', createdAt: { gte: since } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});

console.log(`최근 2일 DAILY: ${posts.length}건\n`);
for (const p of posts) {
  const created = p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(
    p.state.padEnd(18),
    p.account.handle.padEnd(16),
    created.padEnd(28),
    (p.generatedBody ?? '').slice(0, 60).replace(/\n/g, ' '),
  );
}

// 오늘 발행된 것
const todayKST = new Date();
todayKST.setHours(todayKST.getHours() + 9);
const todayStr = todayKST.toISOString().slice(0, 10);
const publishedToday = posts.filter(p => p.publishedAt && p.publishedAt.toISOString().slice(0, 10) >= todayStr);
console.log(`\n오늘 발행된 일상글: ${publishedToday.length}건`);

// PENDING_APPROVAL 중인 것
const pendingAll = await prisma.post.findMany({
  where: { kind: 'DAILY', state: { in: ['PENDING_APPROVAL', 'APPROVED', 'CLASSIFYING', 'COPYING'] } },
  include: { account: { select: { handle: true } } },
});
console.log(`\n대기 중 일상글 (PENDING/APPROVED/CLASSIFYING/COPYING): ${pendingAll.length}건`);
for (const p of pendingAll) {
  console.log(p.state.padEnd(18), p.account.handle.padEnd(16), (p.generatedBody ?? '').slice(0,50).replace(/\n/g,' '));
}

await prisma.$disconnect();
