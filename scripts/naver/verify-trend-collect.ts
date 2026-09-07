import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { collectNaverTrends } from '../../src/modules/pipeline-d/trend-collect/index.js';

async function main() {
  if (!env.COUPANG_ACCESS_KEY || !env.COUPANG_SECRET_KEY) {
    console.error('SKIP: COUPANG_ACCESS_KEY/SECRET 미설정');
    process.exit(2);
  }

  const result = await collectNaverTrends();
  console.log('collectNaverTrends result:', result);

  if (result.inserted <= 0) {
    throw new Error(`inserted=${result.inserted} — 0건 (Coupang 응답 또는 카테고리 코드 확인 필요)`);
  }

  console.log('\n--- 카테고리별 샘플 (실측 카테고리 코드 검증) ---');
  for (const category of Object.keys(result.byCategory)) {
    const rows = await prisma.naverTrendKeyword.findMany({
      where: { category },
      orderBy: { collectedAt: 'desc' },
      take: 5,
    });
    console.log(`\n[${category}] rows=${result.byCategory[category]}`);
    for (const r of rows) {
      console.log(`  rank=${r.rank} keyword="${r.keyword}" productHint="${r.productHint}"`);
    }
    if (rows.length === 0) {
      console.log('  (수집 결과 없음 — 카테고리 코드 확인 필요)');
    }
  }

  const totalInDb = await prisma.naverTrendKeyword.count();
  console.log(`\nDB 전체 NaverTrendKeyword 행 수: ${totalInDb}`);
  if (totalInDb <= 0) throw new Error('DB에 저장된 행이 없음');

  console.log('\nOK: naver trend collect (실측)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
