import { prisma } from '../../src/db/prisma.js';

const inbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'DfdbCCcDbF3' } },
});

console.log('=== 인바운드 ===');
console.log(JSON.stringify(inbound, null, 2));

// 이 소스로 만든 포스트 확인
if (inbound) {
  const posts = await prisma.post.findMany({
    where: { sourceItemId: inbound.id },
    include: { account: { select: { handle: true } } },
  });
  console.log(`\n=== 이 소스로 만든 포스트: ${posts.length}건 ===`);
  for (const p of posts) {
    console.log(`${p.state} | ${p.account.handle} | ${(p.generatedBody ?? '').slice(0, 60).replace(/\n/g, ' ')}`);
  }
}

await prisma.$disconnect();
