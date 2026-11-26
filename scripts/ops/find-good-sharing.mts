import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.benchmarkPost.findMany({
  where: { contentType: 'SHARING', text: { not: '' } },
  orderBy: { repliesCount: 'desc' },
  take: 50,
  select: { id: true, sourceHandle: true, text: true, repliesCount: true, likesCount: true, collectedAt: true },
});

// 패턴 분류
const loyalty = /의리|뒷삭|반하리.*무조건|무조건.*반하리|100%/;
const milestone = /\d+\s*명|넘고\s*싶|남았|채우|목표|달성/;

for (const p of posts) {
  const t = p.text.replace(/\n/g, ' ').slice(0, 100);
  const isLoyalty = loyalty.test(t);
  const isMilestone = milestone.test(t);
  const tag = isLoyalty ? '의리' : isMilestone ? '마일스톤' : '✨기타';
  console.log(`댓글${String(p.repliesCount).padStart(4)} 좋아요${String(p.likesCount).padStart(4)} | ${tag.padEnd(5)} | @${p.sourceHandle.padEnd(16)} | ${t}`);
}
await prisma.$disconnect();
