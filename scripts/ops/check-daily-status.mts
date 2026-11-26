import { prisma } from '../../src/db/prisma.js';

const since = new Date(Date.now() - 7 * 86400000);
const posts = await prisma.post.findMany({
  where: { kind: 'DAILY', publishedAt: { gte: since } },
  include: { account: { select: { handle: true } } },
  orderBy: { publishedAt: 'desc' },
});

const byDate = new Map<string, number>();
for (const p of posts) {
  const d = p.publishedAt!.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  byDate.set(d, (byDate.get(d) ?? 0) + 1);
}

console.log('=== 최근 7일 일상글 발행 ===');
for (const [d, n] of byDate) console.log(d, n + '건');
if (byDate.size === 0) console.log('(없음)');

console.log('\n=== PENDING/APPROVED 일상글 ===');
const pending = await prisma.post.findMany({
  where: { kind: 'DAILY', state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
for (const p of pending) {
  console.log(p.state.padEnd(18), p.account.handle.padEnd(16), p.scheduledAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) ?? '-');
}
console.log(`총 ${pending.length}건`);

console.log('\n=== 소스워치 크론 상태 ===');
const { sourceWatchQueue } = await import('../../src/queues/queues.js');
const schedulers = await sourceWatchQueue.getJobSchedulers();
console.log(`소스워치 스케줄러: ${schedulers.length}개`);
for (const s of schedulers) {
  console.log(JSON.stringify(s, null, 2));
}

await prisma.$disconnect();
