import { prisma } from '../../src/db/prisma.js';

// DcAnJAAbH가 나이키 에어포스였음
const inbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'DcAnJAAbH' } },
});
if (inbound) {
  await prisma.inboundLink.update({
    where: { id: inbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivYUCBcVR6' },
  });
  console.log(`✅ 나이키 에어포스 커머스 링크 업데이트: ${inbound.id}`);
  console.log(`  기존 커머스: ${inbound.manualCommerceUrl ?? '없음'} → ivYUCBcVR6`);
} else {
  console.log('⚠️ DcAnJAAbH 인바운드 못 찾음');
}

await prisma.$disconnect();
