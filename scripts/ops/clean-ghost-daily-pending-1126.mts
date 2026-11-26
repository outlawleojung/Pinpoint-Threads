// 유령 PENDING 일상글 정리 — body 비어있고 telegramMessageId 없는 48h+ PENDING
import { prisma } from '../../src/db/prisma.js';

const twoDaysAgo = new Date(Date.now() - 48 * 3600_000);
const ghosts = await prisma.post.findMany({
  where: {
    kind: 'DAILY', state: 'PENDING_APPROVAL',
    telegramMessageId: null,
    createdAt: { lt: twoDaysAgo },
  },
  select: { id: true, generatedBody: true, account: { select: { handle: true } }, createdAt: true },
});
console.log(`유령 PENDING: ${ghosts.length}건`);
for (const g of ghosts) {
  if (!g.generatedBody || g.generatedBody.trim() === '') {
    await prisma.post.update({
      where: { id: g.id },
      data: { state: 'FAILED', rejectionReason: 'ghost PENDING (body empty, no telegram card) — 2026-11-26 정리' },
    });
    const hours = ((Date.now() - g.createdAt.getTime()) / 3600_000).toFixed(0);
    console.log(`  FAILED @${g.account.handle} ${hours}h`);
  }
}
await prisma.$disconnect();
