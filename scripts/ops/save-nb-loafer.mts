import { prisma } from '../../src/db/prisma.js';

const inbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'BASvX3q6cH' } },
});
if (inbound) {
  await prisma.inboundLink.update({
    where: { id: inbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivYOEvZKI8' },
  });
  console.log(`✅ 뉴발 로퍼 커머스 링크 저장: ${inbound.id}`);
} else {
  console.log('⚠️ 뉴발 로퍼 인바운드 못 찾음 (BASvX3q6cH)');
}

await prisma.$disconnect();
