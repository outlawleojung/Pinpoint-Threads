import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

// 1. sookck.kate 포스트 → hanseoa.pick 으로 이동
const sookck = await prisma.account.findFirst({ where: { handle: 'sookck.kate' }, select: { id: true } });
const hanseoa = await prisma.account.findFirst({ where: { handle: 'hanseoa.pick' }, select: { id: true } });

if (sookck && hanseoa) {
  const moved = await prisma.post.updateMany({
    where: { accountId: sookck.id, state: { in: ['PENDING_APPROVAL', 'DRAFT', 'COPYWRITING'] } },
    data: { accountId: hanseoa.id },
  });
  console.log(`sookck → hanseoa: ${moved.count}건 이동`);
}

// 2. 전체 PENDING_APPROVAL (HOLD 포함) 카드 발송
const pending = await prisma.post.findMany({
  where: { state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});
console.log(`\nPENDING_APPROVAL 총 ${pending.length}건 — 카드 발송 시작\n`);

for (const p of pending) {
  try {
    await sendApprovalRequest(p.id);
    console.log(`✅ ${p.account.handle} | ${p.kind} | ${(p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 60)}`);
  } catch (e) {
    console.log(`❌ ${p.account.handle} | ${p.kind} | ${(e as Error).message.slice(0, 100)}`);
  }
}

await prisma.$disconnect();
process.exit(0);
