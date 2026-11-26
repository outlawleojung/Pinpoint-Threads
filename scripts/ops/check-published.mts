import { prisma } from '../../src/db/prisma.js';

// 최근 7일 발행 완료
const published = await prisma.post.findMany({
  where: {
    state: 'PUBLISHED',
    publishedAt: { gte: new Date(Date.now() - 7 * 24 * 3600000) },
  },
  include: { account: { select: { handle: true } } },
  orderBy: { publishedAt: 'desc' },
});

console.log(`=== 최근 7일 발행 완료: ${published.length}건 ===`);
for (const p of published) {
  const t = p.publishedAt ? new Date(p.publishedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
  const body = (p.generatedBody ?? '').slice(0, 50).replace(/\n/g, ' ');
  const tid = p.threadsPostId ?? '-';
  console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | ${t} | tid=${tid} | ${body}`);
}

// 오늘 APPROVED 예약 중 시간 지난 것
const now = new Date();
const overdue = await prisma.post.findMany({
  where: {
    state: 'APPROVED',
    scheduledAt: { lt: now },
  },
  include: { account: { select: { handle: true } } },
});

if (overdue.length) {
  console.log(`\n⚠️ 예약 시간 지났는데 아직 APPROVED (발행 안됨): ${overdue.length}건`);
  for (const p of overdue) {
    const sched = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
    console.log(`  ${p.kind.padEnd(10)} | ${p.account.handle.padEnd(14)} | sched=${sched} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
  }
}

await prisma.$disconnect();
