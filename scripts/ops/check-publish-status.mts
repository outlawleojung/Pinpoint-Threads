import { prisma } from '../../src/db/prisma.js';

// 1. 최근 24시간 발행된 포스트
const published = await prisma.post.findMany({
  where: {
    state: 'PUBLISHED',
    publishedAt: { gte: new Date(Date.now() - 24 * 3600000) },
  },
  include: { account: { select: { handle: true } } },
  orderBy: { publishedAt: 'desc' },
});

console.log(`=== 최근 24시간 발행 완료: ${published.length}건 ===`);
for (const p of published) {
  const t = p.publishedAt ? new Date(p.publishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | ${t}`);
}

// 2. APPROVED인데 아직 발행 안 된 것
const approved = await prisma.post.findMany({
  where: { state: 'APPROVED' },
  include: { account: { select: { handle: true } } },
  orderBy: { scheduledAt: 'asc' },
});

console.log(`\n=== APPROVED 대기 중: ${approved.length}건 ===`);
for (const p of approved) {
  const sched = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
  const body = (p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ');
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | sched=${sched} | ${body}`);
}

// 3. SCHEDULED 상태
const scheduled = await prisma.post.findMany({
  where: { state: 'SCHEDULED' },
  include: { account: { select: { handle: true } } },
});
console.log(`\n=== SCHEDULED: ${scheduled.length}건 ===`);
for (const p of scheduled) {
  const sched = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | sched=${sched}`);
}

// 4. PENDING_APPROVAL
const pending = await prisma.post.findMany({
  where: { state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
});
console.log(`\n=== PENDING_APPROVAL: ${pending.length}건 ===`);
for (const p of pending) {
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
}

// 5. FAILED 최근 24시간
const failed = await prisma.post.findMany({
  where: {
    state: 'FAILED',
    updatedAt: { gte: new Date(Date.now() - 24 * 3600000) },
  },
  include: { account: { select: { handle: true } } },
});
console.log(`\n=== 최근 24시간 FAILED: ${failed.length}건 ===`);
for (const p of failed) {
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | ${p.errorMessage?.slice(0, 80) ?? '?'}`);
}

await prisma.$disconnect();
