import { prisma } from '../../src/db/prisma.js';

async function main() {
  const cfg = await prisma.naverBlogConfig.create({ data: { topic: '뷰티·생활템' } });
  const product = await prisma.naverProduct.create({
    data: {
      externalId: 'test-1', productName: '테스트 상품', productUrl: 'https://smartstore.naver.com/x/products/1',
      connectUrl: 'https://naver.me/x', imageUrls: [],
    },
  });
  const post = await prisma.naverPost.create({
    data: { topic: cfg.topic, kind: 'AFFILIATE', productId: product.id, imageUrls: [] },
  });
  console.log('created', { cfg: cfg.id, product: product.id, post: post.id, state: post.state });
  // cleanup
  await prisma.naverPost.delete({ where: { id: post.id } });
  await prisma.naverProduct.delete({ where: { id: product.id } });
  await prisma.naverBlogConfig.delete({ where: { id: cfg.id } });
  console.log('OK: naver schema roundtrip + cleanup');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
