import { prisma } from '../../src/db/prisma.js';

// 나이키 브루클린 우먼스 부츠 — "5년만에 새신발샀다 색감 미쳒다 나이키 만세"
const nikeInbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'BAWDXfeOif' } },
});
if (nikeInbound) {
  await prisma.inboundLink.update({
    where: { id: nikeInbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivYCHbUZ8S' },
  });
  console.log(`✅ 나이키 브루클린 커머스 링크 저장: ${nikeInbound.id}`);
} else {
  console.log('⚠️ 나이키 인바운드 못 찾음 (BAWDXfeOif)');
}

// 아식스 젤카야노 — "발바닥 끊어질 것 같을 때 아식스가 진수라고 추천해 주신 분"
const asicsInbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: '_qSi3pBY2' } },
});
if (asicsInbound) {
  await prisma.inboundLink.update({
    where: { id: asicsInbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivYCHbUZ8S' },
  });
  console.log(`✅ 아식스 젤카야노 커머스 링크 저장: ${asicsInbound.id}`);
} else {
  console.log('⚠️ 아식스 인바운드 못 찾음 (_qSi3pBY2)');
}

await prisma.$disconnect();
