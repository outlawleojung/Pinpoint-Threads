import { prisma } from '../../src/db/prisma.js';

async function main() {
  const existing = await prisma.naverBlogConfig.findFirst();
  const data = {
    topic: '뉴트로·생활템·생활가전',
    categories: ['레트로주방', '인테리어소품', '생활가전', '수납정리'],
  };
  const row = existing
    ? await prisma.naverBlogConfig.update({ where: { id: existing.id }, data })
    : await prisma.naverBlogConfig.create({ data });
  console.log('config', { id: row.id, topic: row.topic, categories: row.categories });
  console.log('OK: config seeded');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
