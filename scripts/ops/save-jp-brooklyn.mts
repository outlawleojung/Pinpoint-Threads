import { prisma } from '../../src/db/prisma.js';

const inbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: '_7a0eDPV3' } },
});
if (inbound) {
  await prisma.inboundLink.update({
    where: { id: inbound.id },
    data: {
      manualCommerceUrl: 'https://link.coupang.com/a/ivY3HD04MC',
      manualProductName: '나이키 브루클린 (일본어 소스)',
    },
  });
  console.log(`✅ 일본 나이키 브루클린 커머스 링크 저장: ${inbound.id}`);
} else {
  console.log('⚠️ 인바운드 못 찾음 (_7a0eDPV3)');
}

await prisma.$disconnect();
