import { prisma } from '../../src/db/prisma.js';

const inbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'BAWDXfeOif' } },
});
if (inbound) {
  await prisma.inboundLink.update({
    where: { id: inbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivY3HD04MC' },
  });
  console.log(`✅ 나이키 브루클린 커머스 링크 수정: ${inbound.id}`);
  console.log(`  이전: ivYCHbUZ8S → 수정: ivY3HD04MC`);
} else {
  console.log('⚠️ 나이키 브루클린 인바운드 못 찾음');
}

await prisma.$disconnect();
