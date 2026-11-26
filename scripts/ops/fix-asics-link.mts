import { prisma } from '../../src/db/prisma.js';

const inbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: '_qSi3pBY2' } },
});
if (inbound) {
  await prisma.inboundLink.update({
    where: { id: inbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivY1OEzW9I' },
  });
  console.log(`✅ 아식스 젤카야노 커머스 링크 수정: ${inbound.id}`);
  console.log(`  이전: ivYCHbUZ8S (나이키 브루클린과 동일했음)`);
  console.log(`  수정: ivY1OEzW9I`);
} else {
  console.log('⚠️ 아식스 인바운드 못 찾음');
}

await prisma.$disconnect();
