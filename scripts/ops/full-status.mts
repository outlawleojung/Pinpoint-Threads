import { prisma } from '../../src/db/prisma.js';

// 1. 쇼핑 APPROVED 예약 현황
const shopApproved = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  include: { account: { select: { handle: true } } },
  orderBy: { scheduledAt: 'asc' },
});
console.log(`=== 쇼핑 APPROVED 예약: ${shopApproved.length}건 ===`);
for (const p of shopApproved) {
  const s = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
  console.log(`  ${s.padEnd(16)} | ${p.account.handle.padEnd(14)} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
}

// 2. 쇼핑 PENDING
const shopPending = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
});
console.log(`\n=== 쇼핑 PENDING: ${shopPending.length}건 ===`);
for (const p of shopPending) {
  console.log(`  ${p.account.handle.padEnd(14)} | ${(p.generatedBody ?? '').slice(0, 50).replace(/\n/g, ' ')}`);
}

// 3. 일상 PENDING
const dailyPending = await prisma.post.findMany({
  where: { kind: 'DAILY', state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
console.log(`\n=== 일상 PENDING: ${dailyPending.length}건 ===`);
for (const p of dailyPending) {
  const created = new Date(p.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
  console.log(`  ${created.padEnd(8)} | ${p.account.handle.padEnd(14)} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
}

// 4. 스하리 큐
const sharingCount = await prisma.post.count({ where: { kind: 'SHARING', state: { in: ['PENDING_APPROVAL', 'APPROVED'] } } });
console.log(`\n=== 스하리 큐: ${sharingCount}건 ===`);

// 5. 오늘 발행 예정
const today = new Date();
const todayEnd = new Date(today);
todayEnd.setHours(23, 59, 59);
const todayPosts = await prisma.post.findMany({
  where: {
    state: 'APPROVED',
    scheduledAt: { gte: today, lte: todayEnd },
  },
  include: { account: { select: { handle: true } } },
});
console.log(`\n=== 오늘 발행 예정: ${todayPosts.length}건 ===`);
for (const p of todayPosts) {
  const s = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) : '-';
  console.log(`  ${s} | ${p.account.handle.padEnd(14)} | ${p.kind} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
}

await prisma.$disconnect();
