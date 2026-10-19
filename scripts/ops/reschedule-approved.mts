import { prisma } from '../../src/db/prisma.js';
import { computeManualPublishSchedule } from '../../src/modules/shared/publisher/scheduler.js';
import { publishQueue } from '../../src/queues/queues.js';
const fmt = (d: Date | null) => d ? d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
const ps = await prisma.post.findMany({ where: { state: 'APPROVED', scheduledAt: { not: null } }, include: { account: { select: { handle: true } } }, orderBy: { scheduledAt: 'asc' } });
// 전부 미래 예약에서 빼고(임시로 null) 순서대로 다시 넣는다 → 서로 간섭 없이 새 규칙 적용
await prisma.post.updateMany({ where: { id: { in: ps.map(p => p.id) } }, data: { scheduledAt: null } });
for (const p of ps) {
  const s = await computeManualPublishSchedule(p.accountId, p.kind, { excludePostId: p.id });
  await prisma.post.update({ where: { id: p.id }, data: { scheduledAt: s.targetTime } });
  const job = await publishQueue.getJob(`publish-${p.id}`); if (job) await job.remove().catch(() => {});
  await publishQueue.add('publish', { postId: p.id }, { jobId: `publish-${p.id}`, delay: s.delayMs });
  console.log('RS', p.account.handle.padEnd(14), p.kind.padEnd(8), fmt(p.scheduledAt), '→', fmt(s.targetTime), '|', (p.generatedBody ?? '').replace(/\s+/g, ' ').slice(0, 22));
}
await publishQueue.close(); await prisma.$disconnect(); process.exit(0);
