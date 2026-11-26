import { prisma } from '../../src/db/prisma.js';

console.log('=== 쇼핑 발행 성과 (조회수 순) ===\n');

const published = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PUBLISHED' },
  select: {
    generatedBody: true,
    publishedAt: true,
    account: { select: { handle: true } },
    insightSnapshots: {
      select: { views: true, likes: true, replies: true },
      orderBy: { hoursAfterPublish: 'desc' },
      take: 1,
    },
    sourceItem: { select: { rawText: true, authorHandle: true } },
  },
});

const scored = published
  .map(p => ({
    ...p,
    views: p.insightSnapshots[0]?.views ?? 0,
    likes: p.insightSnapshots[0]?.likes ?? 0,
    srcLikes: 0,
  }))
  .sort((a, b) => b.views - a.views);

for (const p of scored) {
  const snap = p.insightSnapshots[0];
  const date = p.publishedAt?.toISOString().slice(5, 10) ?? '?';
  const body = (p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 80);
  const srcText = (p.sourceItem?.rawText ?? '').replace(/\n/g, ' / ').slice(0, 60);
  console.log(`${String(p.views).padStart(5)}뷰 ❤️${String(snap?.likes ?? 0).padStart(3)} @${p.account.handle.padEnd(16)} [${date}]`);
  console.log(`  카피: "${body}"`);
  if (srcText) console.log(`  소재: "${srcText}"`);
  console.log();
}

console.log(`\n총 ${scored.length}건 | 평균 ${Math.round(scored.reduce((s, p) => s + p.views, 0) / (scored.length || 1))}뷰`);

// 상위/하위 비교
const top5 = scored.slice(0, 5);
const bot5 = scored.slice(-5);
console.log(`\nTOP5 평균: ${Math.round(top5.reduce((s, p) => s + p.views, 0) / (top5.length || 1))}뷰`);
console.log(`BOTTOM5 평균: ${Math.round(bot5.reduce((s, p) => s + p.views, 0) / (bot5.length || 1))}뷰`);

await prisma.$disconnect();
