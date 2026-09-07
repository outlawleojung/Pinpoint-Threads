import { prisma } from '../../src/db/prisma.js';

async function main() {
  const row = await prisma.naverTrendKeyword.create({
    data: { category: '레트로주방', keyword: '테스트 토스터', source: 'COUPANG_RANKING', rank: 1, value: 20 },
  });
  const found = await prisma.naverTrendKeyword.findMany({
    where: { category: '레트로주방', usedAt: null },
    orderBy: { collectedAt: 'desc' },
    take: 1,
  });
  if (found.length !== 1) throw new Error('query failed');
  await prisma.naverTrendKeyword.delete({ where: { id: row.id } });
  console.log('OK: naver trend keyword schema roundtrip + cleanup');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
