import { prisma } from '../../src/db/prisma.js';

// 1. SHOPPING 벤치마크 후보 확인
const lookback = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const benchmarks = await prisma.benchmarkPost.findMany({
  where: {
    contentType: 'SHOPPING',
    collectedAt: { gte: lookback },
    mediaUrls: { isEmpty: false },
  },
  orderBy: [{ likesCount: 'desc' }],
  take: 10,
  select: { id: true, permalink: true, text: true, likesCount: true, collectedAt: true, mediaUrls: true },
});

console.log(`\n=== SHOPPING 벤치마크 후보 (최근 30일, 미디어 있음): ${benchmarks.length}건 ===`);
for (const b of benchmarks) {
  console.log(`  ${b.id.slice(-8)} | likes=${b.likesCount} | media=${b.mediaUrls.length}개 | ${b.collectedAt.toISOString().slice(0, 10)} | ${(b.text ?? '').slice(0, 50)}`);
}

// 2. 팔로워 300+ 계정의 최근 쇼핑 상태
const accounts = await prisma.account.findMany({
  where: { isActive: true, followersCount: { gte: 300 } },
  select: { id: true, handle: true, followersCount: true },
});
console.log(`\n=== 팔로워 300+ 활성 계정: ${accounts.length}개 ===`);
for (const a of accounts) {
  const lastShopping = await prisma.post.findFirst({
    where: { accountId: a.id, kind: 'SHOPPING', state: { notIn: ['REJECTED', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, state: true },
  });
  const hrs = lastShopping ? Math.round((Date.now() - lastShopping.createdAt.getTime()) / 3600000) : null;
  console.log(`  ${a.handle} (${a.followersCount}) | 마지막 쇼핑: ${hrs !== null ? `${hrs}h 전 (${lastShopping!.state})` : '없음'}`);

  // 이 계정이 이미 사용한 벤치마크 IDs
  const used = await prisma.post.findMany({
    where: { accountId: a.id, kind: 'SHOPPING', createdAt: { gte: new Date(Date.now() - 14 * 86400000) }, state: { notIn: ['REJECTED', 'FAILED'] } },
    select: { sourceItem: { select: { sourceUrl: true } } },
  });
  const usedUrls = used.map(p => p.sourceItem?.sourceUrl).filter(Boolean);
  console.log(`    14일 내 사용 소스: ${usedUrls.length}개`);
}

// 3. 크론 실행 시뮬레이션 — runShoppingForAccount 결과 미리보기
const { LINK_MIN_FOLLOWERS } = await import('../../src/modules/pipeline-a/reach-health.js');
console.log(`\n=== 쇼핑 하드룰 ===`);
console.log(`  LINK_MIN_FOLLOWERS: ${LINK_MIN_FOLLOWERS}`);
console.log(`  벤치마크 후보: ${benchmarks.length}건`);

if (benchmarks.length === 0) {
  console.log('\n⚠️ SHOPPING 벤치마크가 0건 — 크론이 돌아도 만들 소재가 없음!');
  console.log('   벤치마크 수집 크론이 꺼져 있거나, 수집된 후보가 전부 소진됨.');
}

await prisma.$disconnect();
