import { prisma } from '../../src/db/prisma.js';

const post = await prisma.post.findFirst({
  where: { state: 'CLASSIFYING', kind: 'SHOPPING' },
  include: { account: { select: { handle: true } }, sourceItem: { select: { sourceUrl: true, rawText: true } } },
});

if (!post) { console.log('없음'); process.exit(0); }

console.log('postId:', post.id);
console.log('계정:', post.account.handle);
console.log('생성일:', post.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
console.log('소스URL:', post.sourceItem?.sourceUrl ?? '-');
console.log('소스텍스트:', (post.sourceItem?.rawText ?? '').slice(0, 100));
console.log('카피:', (post.generatedBody ?? '').slice(0, 100) || '(없음)');
console.log('commerceUrl:', post.commerceUrl ?? '-');
console.log('미디어:', post.mediaUrls.length, '개');

await prisma.$disconnect();
