import { prisma } from '../../src/db/prisma.js';
const posts = await prisma.post.findMany({
  where: { account: { handle: 'sookck.kate' }, kind: 'SHOPPING', state: { in: ['PUBLISHED', 'APPROVED'] } },
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { id: true, state: true, generatedReply: true, threadsReplyId: true, replyFailureReason: true, createdAt: true, publishedAt: true },
});
for (const p of posts) {
  console.log(p.id.slice(-8), '|', p.state, '| replyId:', p.threadsReplyId ?? 'NULL', '| replyFail:', p.replyFailureReason ?? 'NULL');
  console.log('  reply:', (p.generatedReply ?? 'NULL').slice(0, 100));
}
await prisma.$disconnect();
