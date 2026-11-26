import { prisma } from '../../src/db/prisma.js';

// 최근 발행 이력 (최근 3일)
const recent = await prisma.post.findMany({
  where: {
    state: 'PUBLISHED',
    publishedAt: { gte: new Date(Date.now() - 72 * 3600000) },
  },
  include: { account: { select: { handle: true } } },
  orderBy: { publishedAt: 'desc' },
});

console.log(`=== 최근 3일 발행 이력: ${recent.length}건 ===`);
for (const p of recent) {
  const t = p.publishedAt ? new Date(p.publishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | ${t}`);
}

// 일상글 APPROVED 없음 → 왜?
// 일상글 PENDING 9건인데 APPROVED가 0
console.log('\n=== 일상글 PENDING 상세 ===');
const dailyPending = await prisma.post.findMany({
  where: { kind: 'DAILY', state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
for (const p of dailyPending) {
  const created = new Date(p.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`  ${p.account.handle.padEnd(14)} | created=${created} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
}

// 스하리 큐 비어있음 → 소스 확인
console.log('\n=== 스하리 소스 (SHARING_READY) ===');
const sharingReady = await prisma.post.count({ where: { kind: 'SHARING', state: { in: ['PENDING_APPROVAL', 'APPROVED'] } } });
const sharingSource = await prisma.sourceItem.count({ where: { status: 'SHARING_READY' } });
console.log(`  스하리 큐: ${sharingReady}건`);
console.log(`  소스 SHARING_READY: ${sharingSource}건`);

await prisma.$disconnect();
