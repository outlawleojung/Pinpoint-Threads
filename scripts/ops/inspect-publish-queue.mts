import { publishQueue } from '../../src/queues/queues.js';
import { prisma } from '../../src/db/prisma.js';

// 모든 상태의 publish job
const [waiting, delayed, active] = await Promise.all([
  publishQueue.getJobs(['waiting']),
  publishQueue.getJobs(['delayed']),
  publishQueue.getJobs(['active']),
]);

console.log(`publishQueue — waiting: ${waiting.length}, delayed: ${delayed.length}, active: ${active.length}\n`);

const all = [...waiting, ...delayed, ...active];
for (const job of all) {
  const postId = job.data?.postId;
  if (!postId) { console.log(`job ${job.id}: no postId`); continue; }
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { state: true, kind: true, generatedBody: true, account: { select: { handle: true } } },
  });
  const when = job.opts?.delay ? new Date(job.timestamp + job.opts.delay).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : 'now';
  console.log(`job ${job.id} → ${postId}`);
  console.log(`  queued at: ${when}`);
  if (post) {
    console.log(`  @${post.account.handle} [${post.state}] ${post.kind}`);
    console.log(`  body: ${post.generatedBody}`);
  } else {
    console.log(`  (Post not found)`);
  }
  console.log();
}
await prisma.$disconnect();
process.exit(0);
