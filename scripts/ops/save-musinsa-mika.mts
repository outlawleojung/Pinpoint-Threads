import { prisma } from '../../src/db/prisma.js';

const threadsUrl = 'https://www.threads.com/@mika_mama.a/post/DfdbCCcDbF3';
const commerceUrl = 'https://www.musinsa.com/curator/goods/Cvi8Ru27';

// 기존 인바운드 확인
const existing = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'DfdbCCcDbF3' } },
});

if (existing) {
  await prisma.inboundLink.update({
    where: { id: existing.id },
    data: { manualCommerceUrl: commerceUrl },
  });
  console.log(`✅ 기존 인바운드에 무신사 링크 추가: ${existing.id}`);
} else {
  const link = await prisma.inboundLink.create({
    data: {
      url: threadsUrl,
      normalizedUrl: threadsUrl,
      platform: 'THREADS',
      source: 'MANUAL_TELEGRAM',
      status: 'RECEIVED',
      manualCommerceUrl: commerceUrl,
      receivedAt: new Date(),
    },
  });
  console.log(`✅ 새 인바운드 + 무신사 링크 저장: ${link.id}`);
  console.log(`  Threads: ${threadsUrl}`);
  console.log(`  무신사: ${commerceUrl}`);
}

await prisma.$disconnect();
