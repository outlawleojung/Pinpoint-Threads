import { prisma } from '../../src/db/prisma.js';

// 최근 1시간 발행/실패한 모든 포스트
const since = new Date(Date.now() - 3600_000);
const posts = await prisma.post.findMany({
  where: { 
    OR: [
      { publishedAt: { gte: since } },
      { state: 'FAILED', updatedAt: { gte: since } },
      { state: 'PUBLISHED', updatedAt: { gte: since } },
    ],
  },
  select: { 
    id: true, state: true, kind: true, threadsPostId: true, threadsReplyId: true,
    replyFailureReason: true, publishedAt: true, updatedAt: true,
    account: { select: { handle: true } },
  },
  orderBy: { updatedAt: 'desc' },
});

for (const p of posts) {
  console.log(`${p.state.padEnd(18)} ${p.account.handle.padEnd(16)} ${p.kind.padEnd(10)} reply=${p.threadsReplyId ? 'YES' : 'NO'}  reason=${p.replyFailureReason ?? '-'}  ${p.updatedAt.toISOString()}`);
}
console.log(`\n총 ${posts.length}건`);
await prisma.$disconnect();
