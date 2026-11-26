import { prisma } from '../../src/db/prisma.js';

// 1. 오늘 승인된 쇼핑 — 언제 발행되는지
const now = new Date();
const today = new Date(now); today.setHours(0, 0, 0, 0);

const approved = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  include: { account: { select: { handle: true } } },
  orderBy: { scheduledAt: 'asc' },
});
console.log(`=== APPROVED 쇼핑 (${approved.length}건) ===`);
for (const p of approved) {
  const when = p.scheduledAt ? p.scheduledAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '즉시';
  console.log(`  @${p.account.handle.padEnd(16)} ${when} | ${(p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 50)}`);
}

// PENDING_APPROVAL 쇼핑
const pending = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
});
console.log(`\n=== PENDING_APPROVAL 쇼핑 (${pending.length}건) ===`);
for (const p of pending) {
  console.log(`  @${p.account.handle.padEnd(16)} ${(p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 50)}`);
}

// 2. 최근 24h 일상글 실패
const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
const dailyFailed = await prisma.post.findMany({
  where: { kind: 'DAILY', state: 'FAILED', createdAt: { gte: dayAgo } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
  take: 20,
});
console.log(`\n=== 최근 24h 일상 FAILED (${dailyFailed.length}건) ===`);
for (const p of dailyFailed) {
  const err = ((p.failReason ?? '') as string).slice(0, 120);
  console.log(`  @${p.account.handle.padEnd(16)} ${p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })} | ${err}`);
}

// 최근 24h 일상 전체 상태 분포
const dailyRecent = await prisma.post.findMany({
  where: { kind: 'DAILY', createdAt: { gte: dayAgo } },
  select: { state: true },
});
const stateCounts: Record<string, number> = {};
for (const p of dailyRecent) stateCounts[p.state] = (stateCounts[p.state] ?? 0) + 1;
console.log(`\n=== 최근 24h 일상글 상태 분포 ===`);
console.log(stateCounts);

await prisma.$disconnect();
