import { prisma } from '../../src/db/prisma.js';
const active = await prisma.post.findMany({
  where: { kind: 'SHARING', state: { in: ['PENDING_APPROVAL', 'APPROVED', 'PUBLISHING'] } },
  orderBy: { createdAt: 'desc' },
  select: {
    id: true, state: true, generatedBody: true, telegramMessageId: true,
    scheduledAt: true, createdAt: true, account: { select: { handle: true } },
  },
});
console.log(`현재 SHARING PENDING/APPROVED/PUBLISHING: ${active.length}건\n`);
for (const p of active) {
  const c = p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`${p.id} @${p.account.handle} [${p.state}] tg:${p.telegramMessageId ?? '없음'}`);
  console.log(`  created: ${c}`);
  if (p.scheduledAt) console.log(`  scheduled: ${p.scheduledAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  body: ${p.generatedBody}\n`);
}
await prisma.$disconnect();
