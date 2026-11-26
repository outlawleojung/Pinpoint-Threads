import { prisma } from '../../src/db/prisma.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmw7y2uxy00078ccoyfwphyvb' },
  include: { sourceItem: true, commerceProduct: true },
});

if (post) {
  console.log('=== sourceItem ===');
  console.log('rawText:', post.sourceItem?.rawText?.slice(0, 500));
  console.log('\nmediaUrls:', JSON.stringify(post.mediaUrls));
  console.log('\n=== commerceProduct ===');
  console.log('productName:', post.commerceProduct?.productName);
  console.log('channel:', post.commerceProduct?.channel);
}

await prisma.$disconnect();
