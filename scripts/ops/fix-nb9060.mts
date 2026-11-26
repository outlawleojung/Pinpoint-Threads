import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const minyoung = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });

// 뉴발란스 9060 포스트 찾기
const today = new Date(); today.setHours(0, 0, 0, 0);
const nb = await prisma.post.findFirst({
  where: {
    kind: 'SHOPPING',
    createdAt: { gte: today },
    generatedBody: { contains: '뉴발란스' },
  },
  include: { account: { select: { handle: true } } },
});

if (!nb) { console.log('뉴발란스 9060 포스트 없음'); process.exit(1); }

console.log(`현재: ${nb.account.handle} | ${nb.state} | ${(nb.generatedBody ?? '').slice(0, 60)}`);

if (nb.account.handle === 'minyoung.jung') {
  console.log('이미 minyoung.jung — 변경 불필요');
} else if (nb.state === 'PUBLISHED' || nb.state === 'PUBLISHING') {
  console.log('이미 발행됨 — 변경 불가');
} else {
  // APPROVED든 PENDING_APPROVAL이든 아직 발행 전이면 재배정 가능
  await prisma.post.update({
    where: { id: nb.id },
    data: { accountId: minyoung.id, state: 'PENDING_APPROVAL' },
  });
  await sendApprovalRequest(nb.id);
  console.log(`✅ minyoung.jung으로 재배정 + 카드 재발송`);
}

await prisma.$disconnect();
