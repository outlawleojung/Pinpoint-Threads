import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});

console.log(`총 PENDING: ${posts.length}건\n`);
for (const p of posts) {
  const age = Math.round((Date.now() - p.createdAt.getTime()) / 3600000);
  const body = (p.generatedBody ?? '').slice(0, 60).replace(/\n/g, ' ');
  const media = p.mediaUrls.length;
  console.log(`[${p.account.handle.padEnd(14)}] ${p.kind.padEnd(8)} | ${age}h전 | 미디어${media} | "${body}"`);
  console.log(`  id: ${p.id}`);
}

await prisma.$disconnect();
