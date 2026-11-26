// 크레딧 소진으로 실패한 일상글·쇼핑 정리 + inbound 리셋
import { prisma } from '../../src/db/prisma.js';

const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

// 1. 일상 FAILED 전부 REJECTED
const dailyFailed = await prisma.post.findMany({
  where: { kind: 'DAILY', state: 'FAILED', createdAt: { gte: dayAgo } },
  include: { account: { select: { handle: true } } },
});
console.log(`일상 FAILED: ${dailyFailed.length}건`);

if (dailyFailed.length > 0) {
  // 관련 inbound 레코드 리셋 (postIds에서 찾음)
  const inboundIds = new Set<string>();
  for (const p of dailyFailed) {
    const inbounds = await prisma.inboundLink.findMany({
      where: { postIds: { has: p.id } },
      select: { id: true, url: true },
    });
    for (const ib of inbounds) inboundIds.add(ib.id);
  }

  await prisma.post.updateMany({
    where: { id: { in: dailyFailed.map(p => p.id) } },
    data: { state: 'REJECTED' },
  });
  console.log(`  🗑️ ${dailyFailed.length}건 → REJECTED`);

  if (inboundIds.size > 0) {
    await prisma.inboundLink.updateMany({
      where: { id: { in: [...inboundIds] } },
      data: { status: 'FAILED' },
    });
    console.log(`  🔄 관련 inbound ${inboundIds.size}건 FAILED 리셋 (재전송 허용)`);
  }
}

// 2. 쇼핑 실패 3건 — Bnd6l1_bf1, F_EkrVM1b, HXAXyHDiU
const failedShoppingUrls = [
  'https://www.threads.com/share/Bnd6l1_bf1',
  'https://www.threads.com/share/F_EkrVM1b',
  'https://www.threads.com/share/HXAXyHDiU',
];
let resetShop = 0;
for (const url of failedShoppingUrls) {
  const shortId = url.split('/').pop()!;
  const found = await prisma.inboundLink.findFirst({
    where: { OR: [{ url }, { url: { contains: shortId } }] },
  });
  if (found && found.status !== 'FAILED') {
    await prisma.inboundLink.update({ where: { id: found.id }, data: { status: 'FAILED' } });
    resetShop++;
  }
}
console.log(`\n쇼핑 재처리 대상 inbound ${resetShop}건 FAILED 리셋`);

await prisma.$disconnect();
