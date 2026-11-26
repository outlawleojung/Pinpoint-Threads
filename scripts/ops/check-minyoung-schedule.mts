import { prisma } from '../../src/db/prisma.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmw7y09rs00028c2ju3467nht' },
  select: { 
    state: true, scheduledAt: true, kind: true, generatedBody: true,
    generatedReply: true, mediaUrls: true,
    account: { select: { handle: true, followersCount: true } },
    commerceProduct: { select: { productName: true, deeplinkUrl: true } },
  },
});
if (!post) { console.log('없음'); process.exit(1); }
console.log(`상태: ${post.state}`);
console.log(`scheduledAt: ${post.scheduledAt?.toISOString() ?? 'null'}`);
console.log(`현재 시각: ${new Date().toISOString()}`);
console.log(`계정: ${post.account.handle} (팔로워 ${post.account.followersCount})`);
console.log(`상품: ${post.commerceProduct?.productName ?? '-'}`);
console.log(`deeplink: ${post.commerceProduct?.deeplinkUrl ? 'YES' : 'NO'}`);
console.log(`미디어: ${post.mediaUrls?.length ?? 0}개`);
console.log(`\n본문:\n${post.generatedBody?.slice(0, 200)}`);
console.log(`\n댓글:\n${post.generatedReply?.slice(0, 200)}`);

await prisma.$disconnect();
