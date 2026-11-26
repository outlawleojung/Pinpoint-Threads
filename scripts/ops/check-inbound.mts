import { prisma } from '../../src/db/prisma.js';

const links = await prisma.inboundLink.findMany({
  orderBy: { receivedAt: 'desc' },
  take: 20,
  select: {
    id: true, url: true, receivedAt: true, status: true,
    rawText: true, manualCommerceUrl: true, manualProductName: true,
    platform: true, source: true,
  },
});

console.log(`=== 최근 인바운드 링크 (${links.length}건) ===`);
for (const l of links) {
  const label = l.manualProductName ?? l.rawText?.slice(0, 50) ?? '';
  console.log(`${l.receivedAt.toISOString().slice(0, 16)} | ${l.status.padEnd(12)} | ${l.source ?? ''} | ${label}`);
  console.log(`  URL: ${l.url}`);
  if (l.manualCommerceUrl) console.log(`  커머스: ${l.manualCommerceUrl}`);
}

await prisma.$disconnect();
