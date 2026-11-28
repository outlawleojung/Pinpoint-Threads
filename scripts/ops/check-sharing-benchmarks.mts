// 스하리 관련 벤치마크 실측 데이터 조사
import { prisma } from '../../src/db/prisma.js';

const total = await prisma.benchmarkPost.count();
console.log(`전체 BenchmarkPost: ${total}건\n`);

const sharing = await prisma.benchmarkPost.findMany({
  where: {
    OR: [
      { text: { contains: '스하리' } },
      { text: { contains: '반하리' } },
      { text: { contains: '스친' } },
    ],
  },
  orderBy: [{ likesCount: 'desc' }],
  take: 100,
  select: {
    text: true, likesCount: true, repliesCount: true, repostsCount: true,
    sourceHandle: true, publishedAt: true, permalink: true,
  },
});
console.log(`스하리/반하리/스친 포함 벤치마크: ${sharing.length}건\n`);

console.log('═══ TOP 50 (좋아요순) ═══');
for (const b of sharing.slice(0, 50)) {
  const txt = (b.text ?? '').replace(/\n/g, ' ⏎ ').slice(0, 120);
  console.log(`[♥${String(b.likesCount).padStart(4)} 💬${String(b.repliesCount).padStart(3)} 🔁${String(b.repostsCount).padStart(3)}] @${b.sourceHandle.padEnd(22)} ${txt}`);
}

await prisma.$disconnect();
