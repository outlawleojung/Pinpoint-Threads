import { prisma } from '../../src/db/prisma.js';

// 11/10 예정이었던 쇼핑 포스트 확인
const today = new Date('2026-11-10T00:00:00+09:00');
const tomorrow = new Date('2026-11-11T00:00:00+09:00');

const todayPosts = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    scheduledAt: { gte: today, lt: tomorrow },
  },
  include: { account: { select: { handle: true } } },
});

console.log(`11/10 스케줄 쇼핑: ${todayPosts.length}건`);
for (const p of todayPosts) {
  console.log(`${p.account.handle} | ${p.state} | ${p.scheduledAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} | ${p.generatedBody?.slice(0, 40)}`);
}

// 쇼핑 크론이 실행중인지 확인
const { exec } = await import('child_process');
const { promisify } = await import('util');
const execP = promisify(exec);
try {
  const { stdout } = await execP('ps aux | grep -i "shopping\\|cron\\|bull" | grep -v grep');
  console.log('\n프로세스:', stdout.slice(0, 300));
} catch { console.log('\n쇼핑 관련 프로세스 없음'); }

// BullMQ 큐 확인
try {
  const { Queue } = await import('bullmq');
  const q = new Queue('shopping-publish', { connection: { host: '127.0.0.1', port: 6379 } });
  const waiting = await q.getWaitingCount();
  const delayed = await q.getDelayedCount();
  const active = await q.getActiveCount();
  const completed = await q.getCompletedCount();
  console.log(`\nBullMQ shopping-publish: waiting=${waiting} delayed=${delayed} active=${active} completed=${completed}`);
  await q.close();
} catch (e) { console.log('\nBullMQ 확인 실패:', (e as Error).message); }

await prisma.$disconnect();
