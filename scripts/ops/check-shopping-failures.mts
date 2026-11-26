import { prisma } from '../../src/db/prisma.js';

const now = new Date();
const todayStart = new Date('2026-11-13T00:00:00+09:00');
const todayEnd = new Date('2026-11-13T23:59:59+09:00');

// 1. 오늘 스케줄된 쇼핑
const todayPosts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', scheduledAt: { gte: todayStart, lte: todayEnd } },
  select: { id: true, state: true, scheduledAt: true, account: { select: { handle: true } }, generatedBody: true, rejectionReason: true, replyFailureReason: true, retryCount: true },
  orderBy: { scheduledAt: 'asc' },
});
console.log(`=== 오늘(11/13) 쇼핑: ${todayPosts.length}건 ===\n`);
for (const p of todayPosts) {
  const t = new Date(p.scheduledAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const body = (p.generatedBody || '').slice(0, 40).replace(/\n/g, ' ');
  console.log(`${p.state.padEnd(16)} | ${p.account.handle.padEnd(18)} | ${t} | ${body}`);
  if (p.rejectionReason) console.log(`  reject: ${p.rejectionReason}`);
  if (p.replyFailureReason) console.log(`  replyFail: ${p.replyFailureReason}`);
}

// 2. 최근 FAILED 쇼핑
const failed = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'FAILED', updatedAt: { gte: new Date(Date.now() - 7*864e5) } },
  select: { id: true, updatedAt: true, account: { select: { handle: true } }, generatedBody: true, rejectionReason: true, replyFailureReason: true },
  orderBy: { updatedAt: 'desc' },
  take: 5,
});
console.log(`\n=== 최근 7일 FAILED: ${failed.length}건 ===\n`);
for (const p of failed) {
  const t = p.updatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`${p.account.handle.padEnd(18)} | ${t} | ${(p.generatedBody||'').slice(0,30)}`);
  if (p.rejectionReason) console.log(`  reject: ${p.rejectionReason}`);
  if (p.replyFailureReason) console.log(`  replyFail: ${p.replyFailureReason}`);
}

// 3. Overdue APPROVED
const overdue = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED', scheduledAt: { lt: now } },
  select: { id: true, scheduledAt: true, account: { select: { handle: true } }, generatedBody: true },
  orderBy: { scheduledAt: 'asc' },
});
console.log(`\n=== Overdue APPROVED (시간 지남): ${overdue.length}건 ===\n`);
for (const p of overdue) {
  const t = new Date(p.scheduledAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`${p.account.handle.padEnd(18)} | ${t} | ${(p.generatedBody||'').slice(0,40).replace(/\n/g,' ')}`);
}

// 4. 마지막 PUBLISHED 쇼핑
const pub = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PUBLISHED' },
  select: { publishedAt: true, account: { select: { handle: true } } },
  orderBy: { publishedAt: 'desc' },
  take: 3,
});
console.log(`\n=== 최근 PUBLISHED 쇼핑 ===`);
for (const p of pub) {
  const t = p.publishedAt ? new Date(p.publishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '?';
  console.log(`${p.account.handle.padEnd(18)} | ${t}`);
}

await prisma.$disconnect();
