import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { handleApprovalCallback } from '../src/modules/shared/approval-gate/service.js';

async function main() {
  const p = await prisma.post.findFirst({
    where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, account: { select: { handle: true } } },
  });
  if (!p) { console.log('no SHOPPING pending'); process.exit(0); }
  const msg = await handleApprovalCallback('approve', p.id);
  console.log(`✅ SHOPPING approved: ${p.id} @${p.account.handle} → ${msg}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
