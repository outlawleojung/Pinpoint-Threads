/**
 * CLI: 잔여 dummy Threads 계정 정리 (Phase 3 스캐폴딩 잔재).
 * 사용: pnpm exec tsx scripts/purge-dummy.ts
 */
import { prisma } from '../src/db/prisma.js';

async function main(): Promise<void> {
  const dummies = await prisma.account.findMany({
    where: {
      OR: [
        { handle: { startsWith: 'dummy_' } },
        { threadsUserId: { startsWith: 'dummy-' } },
        { accessToken: 'dummy-token' },
      ],
    },
    select: { id: true, handle: true, threadsUserId: true, tokenExpiresAt: true },
  });

  if (!dummies.length) {
    console.log('✅ dummy 계정 없음. 정리 불필요.');
    await prisma.$disconnect();
    return;
  }

  console.log(`발견: ${dummies.length}개`);
  dummies.forEach((d) => console.log(`  - ${d.handle} (${d.id})`));

  for (const d of dummies) {
    // 연관 데이터도 test 잔재라 함께 삭제
    const postCount = await prisma.post.count({ where: { accountId: d.id } });
    const engagementCount = await prisma.engagementLog.count({ where: { accountId: d.id } });
    const dailyCount = await prisma.dailyPostCount.count({ where: { accountId: d.id } });

    if (postCount + engagementCount + dailyCount > 0) {
      console.log(`    · 관련 데이터: Post ${postCount}, EngagementLog ${engagementCount}, DailyPostCount ${dailyCount} → 삭제`);
      await prisma.post.deleteMany({ where: { accountId: d.id } });
      await prisma.engagementLog.deleteMany({ where: { accountId: d.id } });
      await prisma.dailyPostCount.deleteMany({ where: { accountId: d.id } });
    }

    try {
      await prisma.account.delete({ where: { id: d.id } });
      console.log(`  ✓ 삭제: ${d.handle}`);
    } catch (err) {
      console.log(`  ✗ 여전히 삭제 실패 (다른 FK): ${d.handle}: ${(err as Error).message.slice(0, 200)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('실패:', err);
  await prisma.$disconnect();
  process.exit(1);
});
