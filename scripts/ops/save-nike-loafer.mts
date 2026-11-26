import { prisma } from '../../src/db/prisma.js';

const inbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'BATh_T4XjG' } },
});
if (inbound) {
  await prisma.inboundLink.update({
    where: { id: inbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivYRO9TmJU' },
  });
  console.log(`✅ 나이키 에어 로퍼 커머스 링크 저장: ${inbound.id}`);
} else {
  console.log('⚠️ 나이키 에어 로퍼 인바운드 못 찾음 (BATh_T4XjG)');
}

await prisma.$disconnect();
