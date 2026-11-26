import { prisma } from '../../src/db/prisma.js';

const threadsUrl = 'https://www.threads.com/share/DcAnJAAbH';
const commerceUrl = 'https://link.coupang.com/a/ivYf5EgT7Y';

// 이미 있는지 확인
const existing = await prisma.inboundLink.findFirst({
  where: { url: threadsUrl },
});

if (existing) {
  // 커머스 링크만 업데이트
  await prisma.inboundLink.update({
    where: { id: existing.id },
    data: { manualCommerceUrl: commerceUrl },
  });
  console.log(`✅ 기존 링크에 커머스 URL 추가: ${existing.id}`);
} else {
  // 새로 생성
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
  console.log(`✅ 새 인바운드 링크 저장: ${link.id}`);
  console.log(`  Threads: ${threadsUrl}`);
  console.log(`  쿠팡: ${commerceUrl}`);
}

await prisma.$disconnect();
