// minyoung.jung CLASSIFYING 60h stuck 2건 → FAILED (좀비 정리)
import { prisma } from '../../src/db/prisma.js';

const acc = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });
const stuck = await prisma.post.findMany({
  where: { accountId: acc.id, kind: 'SHOPPING', state: 'CLASSIFYING' },
  select: { id: true, createdAt: true, sourceItemId: true },
});

const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
for (const p of stuck) {
  if (p.createdAt < twoHoursAgo) {
    await prisma.post.update({
      where: { id: p.id },
      data: { state: 'FAILED', rejectionReason: 'classifier stuck 60h+ (credit exhaustion 11-24)' },
    });
    console.log(`  FAILED: ${p.id} (${p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);

    // sourceItem(InboundLink)도 재시도 가능하게 리셋
    if (p.sourceItemId) {
      const item = await prisma.sourceItem.findUnique({ where: { id: p.sourceItemId } });
      if (item) {
        // InboundLink 찾아서 FAILED 리셋해서 재크롤링 가능하게
        const inbound = await prisma.inboundLink.findFirst({
          where: { sourceItemId: p.sourceItemId },
          select: { id: true, url: true, status: true },
        });
        if (inbound) console.log(`    inbound: ${inbound.url.slice(0, 60)} [${inbound.status}]`);
      }
    }
  }
}

await prisma.$disconnect();
