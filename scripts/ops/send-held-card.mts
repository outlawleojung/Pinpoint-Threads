import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const id = process.argv[2];
if (!id) { console.error('Usage: npx tsx scripts/ops/send-held-card.mts <postId>'); process.exit(1); }

const p = await prisma.post.findUniqueOrThrow({ where: { id }, select: { id: true, state: true, telegramMessageId: true, generatedBody: true, account: { select: { handle: true } } } });
if (p.state !== 'PENDING_APPROVAL') { console.error(`Post ${id} state=${p.state}, PENDING_APPROVAL 아님`); process.exit(1); }
if (p.telegramMessageId) { console.error(`Post ${id} 이미 카드 발송됨 (tg:${p.telegramMessageId})`); process.exit(1); }

console.log(`[${p.account.handle}] "${p.generatedBody?.substring(0, 50)}..."`);
await sendApprovalRequest(id);
console.log('SENT');
await prisma.$disconnect();
process.exit(0);
