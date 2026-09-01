import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const total = await prisma.benchmarkPost.count({ where: { contentType: 'SHARING' } });
  const embedded = await prisma.benchmarkPost.count({
    where: { contentType: 'SHARING', embeddedAt: { not: null } },
  });
  const tagged = await prisma.benchmarkPost.count({
    where: { contentType: 'SHARING', taggedAt: { not: null } },
  });

  console.log(`SHARING 벤치마크 총: ${total}건`);
  console.log(`  · embedded (Voyage 완료): ${embedded}건`);
  console.log(`  · tagged (viralFactors): ${tagged}건`);
  console.log(`  · RAG 쿼리 가능 (embedded): ${embedded}/${total}`);

  if (embedded < total) {
    console.log(`\n⚠️ ${total - embedded}건 embed 안됨 → RAG 커버리지 손실`);
    const missing = await prisma.benchmarkPost.findMany({
      where: { contentType: 'SHARING', embeddedAt: null },
      select: { sourceHandle: true, repliesCount: true, text: true },
      orderBy: { repliesCount: 'desc' },
    });
    for (const m of missing) {
      console.log(`  - @${m.sourceHandle} · replies=${m.repliesCount} · "${m.text.slice(0, 50)}..."`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
