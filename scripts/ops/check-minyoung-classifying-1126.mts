import { prisma } from '../../src/db/prisma.js';

const acc = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });

const stuck = await prisma.post.findMany({
  where: { accountId: acc.id, kind: 'SHOPPING', state: 'CLASSIFYING' },
  select: {
    id: true, createdAt: true, updatedAt: true, sourceBrief: true,
    commerceProductId: true, sourceItemId: true,
  },
  orderBy: { createdAt: 'desc' },
});

console.log(`CLASSIFYING stuck: ${stuck.length}건\n`);
for (const p of stuck) {
  console.log(`id: ${p.id}`);
  console.log(`  createdAt: ${p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  updatedAt: ${p.updatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  sourceItemId: ${p.sourceItemId ?? '(없음)'}`);
  console.log(`  commerceProductId: ${p.commerceProductId ?? '(없음)'}`);
  const brief = p.sourceBrief as any;
  if (brief?.inboundLinkId) console.log(`  inboundLinkId: ${brief.inboundLinkId}`);
  if (brief?.benchmarkPostId) console.log(`  benchmarkPostId: ${brief.benchmarkPostId}`);
  console.log('');
}

// 자동 크론 벤치마크 풀 — 남성 타겟 벤치마크 수
// BenchmarkPost 모델 확인
await prisma.$disconnect();
