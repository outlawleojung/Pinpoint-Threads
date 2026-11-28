// 지금 스하리 LLM에 few-shot으로 주입되는 벤치마크 TOP 10 그대로 보여주기
import { prisma } from '../../src/db/prisma.js';

const items = await prisma.benchmarkPost.findMany({
  where: {
    OR: [
      { text: { contains: '스하리' } },
      { text: { contains: '반하리' } },
      { text: { contains: '스친' } },
    ],
    likesCount: { gte: 100 },
  },
  orderBy: { likesCount: 'desc' },
  take: 200,
  select: { text: true, likesCount: true, repliesCount: true, sourceHandle: true },
});
const filtered = items.filter((b) => {
  const t = b.text?.trim() ?? '';
  if (!t || t.length > 300) return false;
  if (/coupa\.ng|coupang\.com|musinsa\.com|쿠팡|무신사|할인|체험단|판매|판다|주문|배송/i.test(t)) return false;
  if (/우파|좌파|보수|진보|정치|대통령|민주당|국민의힘/.test(t)) return false;
  return true;
});
const top10 = filtered.slice(0, 10);

console.log('═══ 지금 LLM에 주입되는 벤치마크 TOP 10 (좋아요순) ═══\n');
top10.forEach((b, i) => {
  console.log(`${i + 1}. [♥${b.likesCount} 💬${b.repliesCount}] @${b.sourceHandle}`);
  console.log(`   ${b.text.replace(/\n/g, ' ⏎ ')}\n`);
});

await prisma.$disconnect();
