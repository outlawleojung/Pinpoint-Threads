import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

// 나이키 (sookck.kate)
await sendApprovalRequest('cmvus9fq700028cniz4bkiqq5');
console.log('나이키 카드 발송 완료');

// 뉴발란스 (pikkseetem)
await sendApprovalRequest('cmvuse8hi00028clfwj1626gi');
console.log('뉴발란스 카드 발송 완료');

const { prisma } = await import('../../src/db/prisma.js');
await prisma.$disconnect();
