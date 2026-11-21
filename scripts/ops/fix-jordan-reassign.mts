import { prisma } from '../../src/db/prisma.js';

const post = await prisma.post.findFirst({
  where: {
    kind: 'SHOPPING',
    generatedBody: { contains: '에어조던 리브타이츠' },
    account: { handle: 'minyoung.jung' },
    state: 'PENDING_APPROVAL',
  },
  select: { id: true, generatedBody: true },
});

if (!post) {
  console.log('포스트 못 찾음');
  await prisma.$disconnect();
  process.exit(1);
}

const pikkseetem = await prisma.account.findFirstOrThrow({ where: { handle: 'pikkseetem' } });
await prisma.post.update({ where: { id: post.id }, data: { accountId: pikkseetem.id } });
console.log('✅ 재배정 완료: minyoung.jung → pikkseetem');
console.log('postId:', post.id);

await prisma.$disconnect();
