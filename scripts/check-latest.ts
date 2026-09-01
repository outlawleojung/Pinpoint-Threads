import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const posts = await prisma.benchmarkPost.findMany({
    orderBy: { collectedAt: 'desc' },
    take: 5,
    select: { id: true, sourceHandle: true, contentType: true, likesCount: true, text: true },
  });
  for (const p of posts) {
    console.log(`${p.contentType ?? '?'} · @${p.sourceHandle} · 👍${p.likesCount}`);
    console.log(`  ${p.text.slice(0, 80).replace(/\n/g, ' ')}...`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
