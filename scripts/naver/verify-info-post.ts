import { prisma } from '../../src/db/prisma.js';
import { buildInfoPost, pickNextCategory } from '../../src/modules/pipeline-d/info-post/index.js';

async function main() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg || cfg.categories.length === 0) { console.error('SKIP: config/categories 없음 — seed-config 먼저'); process.exit(2); }
  const cat = await pickNextCategory();
  console.log('picked category', cat);
  const out = await buildInfoPost();
  console.log('built', out);
  const post = await prisma.naverPost.findUnique({ where: { id: out.naverPostId } });
  if (!post || post.state !== 'PLANNED' || post.kind !== 'INFO') throw new Error('INFO PLANNED 저장 실패');
  if (post.productId) throw new Error('INFO 글에 상품 연결됨(있으면 안 됨)');
  console.log('OK: info post (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
