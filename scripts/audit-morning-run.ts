import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  console.log('=== 오늘 (2026-09-02) 수집 · 발행 감사 ===\n');

  // 1) 오늘 새로 수집된 SHARING 벤치마크
  const collectedToday = await prisma.benchmarkPost.count({
    where: { contentType: 'SHARING', collectedAt: { gte: todayStart } },
  });
  const totalSharing = await prisma.benchmarkPost.count({ where: { contentType: 'SHARING' } });
  console.log(`[SHARING 벤치마크]`);
  console.log(`  · 오늘 (2026-09-02 00:00 이후) 신규 수집: ${collectedToday}건`);
  console.log(`  · 전체 SHARING 풀: ${totalSharing}건\n`);

  // 2) generateSharingCopy 가 실제 참고한 top 5 pool
  const top5Pool = await prisma.benchmarkPost.findMany({
    where: { contentType: 'SHARING' },
    orderBy: { repliesCount: 'desc' },
    take: 5,
    select: { sourceHandle: true, repliesCount: true, text: true, collectedAt: true },
  });
  console.log(`[copywriter가 참고한 top 5 pool]`);
  for (const b of top5Pool) {
    console.log(`  · @${b.sourceHandle} · replies=${b.repliesCount} · collected=${b.collectedAt.toISOString().slice(0, 10)}`);
    console.log(`    "${b.text.slice(0, 80).replace(/\n/g, ' ')}..."`);
  }
  console.log();

  // 3) 오늘 아침 만들어진 SHARING Post 5건
  const postsToday = await prisma.post.findMany({
    where: { kind: 'SHARING', createdAt: { gte: todayStart } },
    orderBy: { createdAt: 'asc' },
    select: {
      account: { select: { handle: true } },
      state: true,
      createdAt: true,
      generatedBody: true,
    },
  });
  console.log(`[오늘 생성된 SHARING Post: ${postsToday.length}건]`);
  for (const p of postsToday) {
    console.log(`  · @${p.account.handle} · state=${p.state} · ${p.createdAt.toISOString()}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
