import { prisma } from '../../src/db/prisma.js';

const acc = await prisma.account.findFirst({
  where: { handle: { contains: 'sookck' } },
  select: { id: true, handle: true, followersCount: true },
});
if (!acc) { console.log('계정 없음'); process.exit(1); }
console.log(`\n=== ${acc.handle} (팔로워: ${acc.followersCount}) ===\n`);

const posts = await prisma.post.findMany({
  where: { accountId: acc.id, state: 'PUBLISHED' },
  orderBy: { publishedAt: 'desc' },
  take: 15,
  select: {
    id: true, kind: true,
    generatedBody: true,
    publishedAt: true,
    threadsPostId: true,
    insightSnapshots: {
      orderBy: { hoursAfterPublish: 'desc' },
      take: 1,
      select: { hoursAfterPublish: true, views: true, likes: true, replies: true, reposts: true, quotes: true },
    },
  },
});

for (const p of posts) {
  const date = p.publishedAt?.toISOString().slice(0, 10) ?? '미발행';
  const body = (p.generatedBody ?? '').slice(0, 65).replace(/\n/g, ' ');
  const snap = p.insightSnapshots[0];
  const eng = snap
    ? `👁${snap.views} ❤${snap.likes} 💬${snap.replies} 🔁${snap.reposts} (${snap.hoursAfterPublish}h)`
    : '인사이트 없음';
  console.log(`[${p.kind.padEnd(8)}] ${date} | ${eng}`);
  console.log(`  "${body}"`);
  console.log('');
}

await prisma.$disconnect();
