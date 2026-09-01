import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const r = await prisma.benchmarkPost.findMany({
    where: { contentType: 'SHARING' },
    select: { sourceHandle: true, repliesCount: true, likesCount: true, text: true, permalink: true },
    orderBy: { repliesCount: 'desc' },
    take: 5,
  });
  console.log(`총 ${r.length}건 (top 5)\n`);
  for (const b of r) {
    console.log(`@${b.sourceHandle} · replies=${b.repliesCount} · likes=${b.likesCount}`);
    console.log(`  ${b.text.slice(0, 80).replace(/\n/g, ' ')}`);
    console.log(`  ${b.permalink}\n`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
