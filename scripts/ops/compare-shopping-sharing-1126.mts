import { prisma } from '../../src/db/prisma.js';
const dayAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

for (const kind of ['SHOPPING', 'SHARING'] as const) {
  const posts = await prisma.post.findMany({
    where: { kind, createdAt: { gte: dayAgo } },
    select: { state: true, scheduledAt: true, publishedAt: true, rejectionReason: true, account: { select: { handle: true } } },
  });
  const counts: Record<string, number> = {};
  let withSchedule = 0, published = 0;
  for (const p of posts) {
    counts[p.state] = (counts[p.state] ?? 0) + 1;
    if (p.scheduledAt) withSchedule++;
    if (p.publishedAt) published++;
  }
  console.log(`\n=== ${kind} 최근 72h (총 ${posts.length}) ===`);
  console.log('상태:', counts);
  console.log(`scheduledAt: ${withSchedule}, publishedAt: ${published}`);

  // FAILED 샘플
  const failed = posts.filter(p => p.state === 'FAILED').slice(0, 5);
  for (const p of failed) {
    console.log(`  FAILED @${p.account.handle}: ${((p.rejectionReason ?? '') as string).slice(0, 100)}`);
  }
}

await prisma.$disconnect();
