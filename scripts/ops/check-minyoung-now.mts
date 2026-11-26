import { prisma } from '../../src/db/prisma.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmw7y09rs00028c2ju3467nht' },
  select: { 
    state: true, threadsPostId: true, threadsReplyId: true, 
    replyFailureReason: true, publishedAt: true, updatedAt: true,
    account: { select: { handle: true } },
  },
});
if (!post) { console.log('없음'); process.exit(1); }
console.log(`상태: ${post.state}`);
console.log(`threadsPostId: ${post.threadsPostId ?? 'null'}`);
console.log(`threadsReplyId: ${post.threadsReplyId ?? 'null'}`);
console.log(`replyFailureReason: ${post.replyFailureReason ?? 'null'}`);
console.log(`publishedAt: ${post.publishedAt?.toISOString() ?? 'null'}`);
console.log(`updatedAt: ${post.updatedAt.toISOString()}`);

await prisma.$disconnect();
