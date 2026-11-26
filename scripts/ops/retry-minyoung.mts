import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmw7y09rs00028c2ju3467nht' },
  select: { state: true, kind: true, threadsPostId: true, threadsReplyId: true, account: { select: { handle: true } }, commerceProduct: { select: { productName: true } } },
});

if (!post) { console.log('포스트 없음'); process.exit(1); }
console.log(`상태: ${post.state} | ${post.account.handle} | ${post.kind}`);
console.log(`threadsPostId: ${post.threadsPostId ?? 'null'}`);
console.log(`상품: ${post.commerceProduct?.productName ?? '-'}`);

if (post.state === 'FAILED') {
  await prisma.post.update({
    where: { id: 'cmw7y09rs00028c2ju3467nht' },
    data: { state: 'PENDING_APPROVAL', threadsPostId: null, threadsReplyId: null, replyFailureReason: null },
  });
  await sendApprovalRequest('cmw7y09rs00028c2ju3467nht');
  console.log('✅ FAILED → PENDING_APPROVAL 복구 + 카드 재발송');
} else if (post.state === 'PENDING_APPROVAL') {
  await sendApprovalRequest('cmw7y09rs00028c2ju3467nht');
  console.log('✅ 카드 재발송');
} else {
  console.log(`현재 상태 ${post.state} — 수동 확인 필요`);
}

await prisma.$disconnect();
