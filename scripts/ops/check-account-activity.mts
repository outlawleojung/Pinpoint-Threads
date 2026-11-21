import { prisma } from '../../src/db/prisma.js';

const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true, followersCount: true },
  orderBy: { handle: 'asc' },
});

const weekAgo = new Date(Date.now() - 7 * 864e5);

console.log('═══════════════════════════════════════════════════════');
console.log('📊 계정별 최근 7일 발행 현황');
console.log('═══════════════════════════════════════════════════════\n');

for (const a of accounts) {
  const posts = await prisma.post.findMany({
    where: { accountId: a.id, state: 'PUBLISHED', publishedAt: { gte: weekAgo } },
    select: { kind: true, publishedAt: true },
    orderBy: { publishedAt: 'desc' },
  });

  const byKind: Record<string, number> = {};
  for (const p of posts) { byKind[p.kind] = (byKind[p.kind] ?? 0) + 1; }

  const byDay = new Map<string, string[]>();
  for (const p of posts) {
    const day = p.publishedAt!.toISOString().slice(5, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(p.kind);
  }

  console.log(`@${a.handle} (팔로워 ${a.followersCount ?? '?'})`);
  console.log(`  총 ${posts.length}건: ${Object.entries(byKind).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  for (const [day, kinds] of [...byDay.entries()].sort()) {
    console.log(`    ${day}: ${kinds.join(', ')}`);
  }

  // 대기 중
  const pending = await prisma.post.count({
    where: { accountId: a.id, state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  });
  if (pending > 0) console.log(`  ⏳ 대기 중: ${pending}건`);
  console.log();
}

await prisma.$disconnect();
