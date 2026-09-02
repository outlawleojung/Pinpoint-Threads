import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const url = 'https://www.threads.com/@mon.i1l/post/DctUf-9Gt2N?hl=ko';
  // Cascade: 관련 Post 도 지워야 함
  const posts = await prisma.post.findMany({ where: { sourceItem: { sourceUrl: url } }, select: { id: true } });
  for (const p of posts) {
    await prisma.postInsightSnapshot.deleteMany({ where: { postId: p.id } });
    await prisma.post.delete({ where: { id: p.id } });
  }
  const r = await prisma.sourceItem.deleteMany({ where: { sourceUrl: url } });
  console.log('SourceItem deleted:', r.count, '· Posts deleted:', posts.length);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
