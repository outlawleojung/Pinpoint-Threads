import { prisma } from '../../src/db/prisma.js';

// 1. 최근 24시간 실패
console.log('=== 최근 실패 ===');
const failures = await prisma.post.findMany({
  where: { state: 'FAILED', updatedAt: { gte: new Date(Date.now() - 2 * 864e5) } },
  select: { kind: true, rejectionReason: true, replyFailureReason: true, updatedAt: true, account: { select: { handle: true } } },
  orderBy: { updatedAt: 'desc' },
  take: 15,
});
for (const f of failures) {
  const d = f.updatedAt.toISOString().slice(5, 16);
  console.log(`  [${d}] @${f.account.handle.padEnd(16)} ${f.kind.padEnd(10)} ${(f.rejectionReason ?? f.replyFailureReason ?? '').slice(0, 100)}`);
}
console.log(`  총: ${failures.length}건\n`);

// 2. 승인 후 발행 실패 (APPROVED인데 발행 안 된 것)
console.log('=== APPROVED 상태 (발행 대기) ===');
const approved = await prisma.post.findMany({
  where: { state: 'APPROVED' },
  select: { kind: true, createdAt: true, generatedBody: true, account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
for (const a of approved) {
  const d = a.createdAt.toISOString().slice(5, 16);
  const body = (a.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 55);
  console.log(`  [${d}] @${a.account.handle.padEnd(16)} ${a.kind.padEnd(10)} ${body}`);
}
console.log(`  총: ${approved.length}건\n`);

// 3. 최근 발행 성공
console.log('=== 최근 발행 성공 (24h) ===');
const published = await prisma.post.findMany({
  where: { state: 'PUBLISHED', publishedAt: { gte: new Date(Date.now() - 864e5) } },
  select: { kind: true, publishedAt: true, account: { select: { handle: true } } },
  orderBy: { publishedAt: 'desc' },
});
for (const p of published) {
  const d = p.publishedAt?.toISOString().slice(5, 16) ?? '?';
  console.log(`  [${d}] @${p.account.handle.padEnd(16)} ${p.kind}`);
}
console.log(`  총: ${published.length}건`);

await prisma.$disconnect();
