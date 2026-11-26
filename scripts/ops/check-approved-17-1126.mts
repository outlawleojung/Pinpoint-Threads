import { prisma } from '../../src/db/prisma.js';

// 11-23 부터 생성된 모든 쇼핑 (17건 배치 포함)
const since = new Date('2026-11-23T00:00:00+09:00');
const all = await prisma.post.findMany({
  where: { kind: 'SHOPPING', createdAt: { gte: since }, approvedAt: { not: null } },
  select: {
    id: true, state: true, createdAt: true, approvedAt: true, scheduledAt: true,
    publishedAt: true, rejectionReason: true, threadsPostId: true,
    generatedBody: true, account: { select: { handle: true } },
  },
  orderBy: { approvedAt: 'asc' },
});

console.log(`승인된 쇼핑 (11-23 이후): ${all.length}건\n`);
const now = new Date();
for (const p of all) {
  const sch = p.scheduledAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) ?? '(없음)';
  const pub = p.publishedAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) ?? '(미발행)';
  const overdue = p.scheduledAt && p.scheduledAt < now && !p.publishedAt ? ' ⚠️지났음' : '';
  console.log(`@${p.account.handle.padEnd(16)} [${p.state}]`);
  console.log(`  승인: ${p.approvedAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  예정: ${sch}${overdue}`);
  console.log(`  발행: ${pub}`);
  console.log(`  threadsPostId: ${p.threadsPostId ?? '(없음)'}`);
  console.log(`  body: ${(p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 60)}`);
  console.log('');
}

// BullMQ 큐 상태도 체크
console.log('현재 시각:', now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));

await prisma.$disconnect();
