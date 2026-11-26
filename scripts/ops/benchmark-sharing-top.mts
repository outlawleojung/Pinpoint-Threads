import { prisma } from '../../src/db/prisma.js';

// 1. 우리 발행 스하리 중 조회수 TOP
console.log('=== 우리 스하리 TOP 10 (조회수) ===\n');
const ourSharing = await prisma.post.findMany({
  where: { kind: 'SHARING', state: 'PUBLISHED' },
  select: {
    generatedBody: true,
    publishedAt: true,
    account: { select: { handle: true } },
    insightSnapshots: { select: { views: true, likes: true, replies: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
  },
});
const scored = ourSharing
  .map(p => ({ ...p, views: p.insightSnapshots[0]?.views ?? 0 }))
  .sort((a, b) => b.views - a.views)
  .slice(0, 15);

for (const p of scored) {
  const snap = p.insightSnapshots[0];
  const date = p.publishedAt?.toISOString().slice(5, 10) ?? '?';
  const body = (p.generatedBody ?? '').replace(/\n/g, ' / ');
  console.log(`  ${String(p.views).padStart(5)}뷰 ❤️${String(snap?.likes ?? 0).padStart(3)} 💬${String(snap?.replies ?? 0).padStart(2)} [${date}] @${p.account.handle}`);
  console.log(`    "${body}"\n`);
}

// 2. 벤치마크 DB에서 스하리 관련 소스 (sourceItem에서 인기 있는 것들)
console.log('\n=== 벤치마크 DB — 스하리 소스 TOP (replies 기준) ===\n');
const benchmarks = await prisma.benchmark.findMany({
  where: { platform: 'THREADS' },
  select: { text: true, likesCount: true, repliesCount: true, sourceHandle: true },
  orderBy: { repliesCount: 'desc' },
  take: 20,
});
for (const b of benchmarks) {
  const text = (b.text ?? '').replace(/\n/g, ' / ').slice(0, 100);
  console.log(`  💬${String(b.repliesCount ?? 0).padStart(4)} ❤️${String(b.likesCount ?? 0).padStart(5)} @${(b.sourceHandle ?? '?').padEnd(20)} "${text}"`);
}

await prisma.$disconnect();
