import { prisma } from '../../src/db/prisma.js';
import { ThreadsClient } from '../../src/infra/threads-client.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmw7y09rs00028c2ju3467nht' },
  select: { state: true, threadsPostId: true, threadsReplyId: true, replyFailureReason: true, account: { select: { handle: true, threadsAccessToken: true } } },
});
if (!post) { console.log('없음'); process.exit(1); }
console.log(`상태: ${post.state}`);
console.log(`threadsPostId: ${post.threadsPostId ?? 'null'}`);
console.log(`threadsReplyId: ${post.threadsReplyId ?? 'null'}`);
console.log(`replyFailureReason: ${post.replyFailureReason ?? 'null'}`);

if (post.threadsPostId && !post.threadsReplyId) {
  const client = new ThreadsClient();
  try {
    await client.deletePost(post.account.threadsAccessToken!, post.threadsPostId);
    console.log('✅ Threads 본문 삭제 완료');
  } catch (e: any) {
    console.log('❌ 삭제 실패:', e.message);
  }
  await prisma.post.update({
    where: { id: 'cmw7y09rs00028c2ju3467nht' },
    data: { state: 'FAILED', threadsPostId: null, threadsReplyId: null, replyFailureReason: post.replyFailureReason ?? '댓글 없이 발행됨 — 수동 삭제' },
  });
  console.log('✅ DB → FAILED 처리');
}

await prisma.$disconnect();
