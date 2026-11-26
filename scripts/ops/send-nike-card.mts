import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
await sendApprovalRequest('cmwf33g9800028cpxoc8gdl8s');
console.log('✅ 카드 발송 완료');
await prisma.$disconnect();
