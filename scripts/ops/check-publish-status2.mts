import { prisma } from '../../src/db/prisma.js';

// PENDING_APPROVAL
const pending = await prisma.post.findMany({
  where: { state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
});
console.log(`=== PENDING_APPROVAL: ${pending.length}건 ===`);
for (const p of pending) {
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | ${(p.generatedBody ?? '').slice(0, 50).replace(/\n/g, ' ')}`);
}

// FAILED 최근 48시간
const failed = await prisma.post.findMany({
  where: {
    state: 'FAILED',
    updatedAt: { gte: new Date(Date.now() - 48 * 3600000) },
  },
  include: { account: { select: { handle: true } } },
  orderBy: { updatedAt: 'desc' },
});
console.log(`\n=== 최근 48시간 FAILED: ${failed.length}건 ===`);
for (const p of failed) {
  const t = p.updatedAt ? new Date(p.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | ${t} | ${(p.errorMessage ?? '?').slice(0, 80)}`);
}

// 크론 상태 - 최근 스케줄러 로그
console.log('\n=== 스하리/일상 큐 상태 ===');
const sharingPending = await prisma.post.count({ where: { kind: 'SHARING', state: 'PENDING_APPROVAL' } });
const sharingApproved = await prisma.post.count({ where: { kind: 'SHARING', state: 'APPROVED' } });
const dailyPending = await prisma.post.count({ where: { kind: 'DAILY', state: 'PENDING_APPROVAL' } });
const dailyApproved = await prisma.post.count({ where: { kind: 'DAILY', state: 'APPROVED' } });
console.log(`  스하리: PENDING=${sharingPending}, APPROVED=${sharingApproved}`);
console.log(`  일상: PENDING=${dailyPending}, APPROVED=${dailyApproved}`);

// 쇼핑 APPROVED 예약 시간 확인
console.log('\n=== 쇼핑 APPROVED 예약 상세 ===');
const shopApproved = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  include: { account: { select: { handle: true } } },
  orderBy: { scheduledAt: 'asc' },
});
for (const p of shopApproved) {
  const sched = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'NO SCHEDULE';
  const now = new Date();
  const isPast = p.scheduledAt && p.scheduledAt < now;
  console.log(`  ${p.account.handle.padEnd(14)} | ${sched} | ${isPast ? '⚠️ 지남' : '⏳ 대기'} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
}

await prisma.$disconnect();
