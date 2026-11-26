import { prisma } from '../../src/db/prisma.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmvuv29u20001ifgma5bhozm7' },
  include: { account: { select: { handle: true } }, sourceItem: true },
});

if (!post) { console.log('포스트 없음'); process.exit(1); }

console.log('handle:', post.account.handle);
console.log('kind:', post.kind);
console.log('state:', post.state);
console.log('body:', post.generatedBody);
console.log('mediaUrls:', post.mediaUrls);
console.log('sourceMediaUrls:', post.sourceMediaUrls);
console.log('sourceItem:', post.sourceItem?.rawText ?? 'null');
console.log('createdAt:', post.createdAt);

// 최근 kle0_lee 포스트 확인
const acc = await prisma.account.findFirst({ where: { handle: { contains: 'kle0' } } });
if (acc) {
  const recent = await prisma.post.findMany({
    where: { accountId: acc.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, kind: true, state: true, generatedBody: true, createdAt: true },
  });
  console.log('\n최근 kle0_lee 포스트:');
  for (const p of recent) {
    console.log(`  [${p.state}] ${p.kind} | ${p.createdAt.toISOString().slice(0,16)} | "${(p.generatedBody ?? '').slice(0,50)}"`);
  }
}

await prisma.$disconnect();
