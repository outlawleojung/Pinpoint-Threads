import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { handleApprovalCallback } from '../src/modules/shared/approval-gate/service.js';

async function main() {
  const pending = await prisma.post.findMany({
    where: { kind: 'SHARING', state: 'PENDING_APPROVAL' },
    select: { id: true, account: { select: { handle: true } } },
  });
  console.log(`PENDING_APPROVAL SHARING 포스트: ${pending.length}건 발행 진행\n`);
  for (const p of pending) {
    try {
      const msg = await handleApprovalCallback('approve', p.id);
      console.log(`✅ @${p.account.handle} · ${p.id} → ${msg}`);
    } catch (err) {
      console.error(`❌ @${p.account.handle} · ${p.id} → ${(err as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
