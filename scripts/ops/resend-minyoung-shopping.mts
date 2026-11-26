import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmw7y09rs00028c2ju3467nht' },
  select: { state: true, account: { select: { handle: true } }, kind: true },
});
console.log('현재 상태:', post?.state, post?.account.handle, post?.kind);

if (post && post.state === 'PENDING_APPROVAL') {
  await sendApprovalRequest('cmw7y09rs00028c2ju3467nht');
  console.log('✅ 카드 재발송 완료');
}

await prisma.$disconnect();
