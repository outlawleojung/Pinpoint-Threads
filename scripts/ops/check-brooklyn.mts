import { prisma } from '../../src/db/prisma.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmw7y2uxy00078ccoyfwphyvb' },
  include: { account: { select: { handle: true } } },
});

if (post) {
  console.log(`계정: ${post.account.handle}`);
  console.log(`상태: ${post.state}`);
  console.log(`\n=== 본문 ===`);
  console.log(post.generatedBody);
  console.log(`\n=== 고정댓글 ===`);
  console.log(post.generatedReply);
}

await prisma.$disconnect();
