import { prisma } from '../../src/db/prisma.js';
import { redisConnection } from '../../src/queues/connection.js';
import { Queue } from 'bullmq';

const q = new Queue('sharing-publish', { connection: redisConnection });

const repeatable = await q.getRepeatableJobs();
console.log('=== 스하리 Repeatable Jobs ===');
for (const r of repeatable) {
  console.log(`  name=${r.name} pattern=${r.pattern} next=${new Date(r.next).toISOString().slice(0, 16)}`);
}
if (repeatable.length === 0) console.log('  (없음 — 워커 재시작 대기)');

const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true },
  orderBy: { handle: 'asc' },
});

console.log('\n=== 계정별 마지막 스하리 ===');
for (const acc of accounts) {
  const last = await prisma.post.findFirst({
    where: { accountId: acc.id, kind: 'SHARING', state: { in: ['PUBLISHED', 'APPROVED'] } },
    orderBy: { createdAt: 'desc' },
    select: { state: true, publishedAt: true, scheduledAt: true, createdAt: true },
  });
  const when = last?.publishedAt ?? last?.scheduledAt ?? last?.createdAt;
  console.log(`@${acc.handle}: [${last?.state ?? 'N/A'}] ${when?.toISOString().slice(0, 16) ?? '없음'}`);
}

await q.close();
await redisConnection.quit();
await prisma.$disconnect();
