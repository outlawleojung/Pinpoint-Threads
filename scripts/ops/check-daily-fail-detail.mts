import { prisma } from '../../src/db/prisma.js';
const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
const failed = await prisma.post.findMany({
  where: { kind: 'DAILY', state: 'FAILED', createdAt: { gte: dayAgo } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
for (const p of failed) {
  console.log(`\n@${p.account.handle} ${p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  id: ${p.id}`);
  console.log(`  state: ${p.state}`);
  console.log(`  failReason: ${JSON.stringify(p.failReason)}`);
  console.log(`  sourceUrl: ${p.sourceUrl ?? '(없음)'}`);
  console.log(`  body: ${(p.generatedBody ?? '(비어있음)').slice(0, 100)}`);
  console.log(`  mediaCount: ${p.mediaUrls.length}`);
}
await prisma.$disconnect();
