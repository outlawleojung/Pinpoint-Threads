import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const postId = 'cmvus0jlb00018ce2md2m6pc1';
await sendApprovalRequest(postId);
console.log('승인 카드 발송 완료');

const { prisma } = await import('../../src/db/prisma.js');
await prisma.$disconnect();
