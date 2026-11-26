import { prisma } from '../../src/db/prisma.js';

const since = new Date(Date.now() - 24 * 3600_000);

// 최근 실패
const failed = await prisma.post.findMany({
  where: { state: 'FAILED', updatedAt: { gte: since } },
  select: { id: true, kind: true, state: true, replyFailureReason: true, rejectionReason: true, updatedAt: true, account: { select: { handle: true } } },
  orderBy: { updatedAt: 'desc' },
  take: 10,
});
console.log('=== FAILED (최근 24h) ===');
for (const p of failed) {
  console.log(`${p.account.handle.padEnd(16)} ${p.kind.padEnd(10)} ${p.id.slice(0,20)}  reason: ${p.replyFailureReason ?? p.rejectionReason ?? '-'}`);
}

// 최근 발행
const published = await prisma.post.findMany({
  where: { state: 'PUBLISHED', publishedAt: { gte: since } },
  select: { id: true, kind: true, threadsPostId: true, threadsReplyId: true, publishedAt: true, account: { select: { handle: true } } },
  orderBy: { publishedAt: 'desc' },
  take: 10,
});
console.log('\n=== PUBLISHED (최근 24h) ===');
for (const p of published) {
  console.log(`${p.account.handle.padEnd(16)} ${p.kind.padEnd(10)} reply=${p.threadsReplyId ? 'YES' : 'NO'}  ${p.publishedAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
}

// APPROVED 대기 중
const approved = await prisma.post.findMany({
  where: { state: 'APPROVED' },
  select: { id: true, kind: true, scheduledAt: true, account: { select: { handle: true } } },
  orderBy: { scheduledAt: 'asc' },
});
console.log('\n=== APPROVED 대기 ===');
for (const p of approved) {
  console.log(`${p.account.handle.padEnd(16)} ${p.kind.padEnd(10)} scheduled: ${p.scheduledAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) ?? 'null'}`);
}

await prisma.$disconnect();
