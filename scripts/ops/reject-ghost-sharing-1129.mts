// 쓰레기 바디 2건 REJECT
import { prisma } from '../../src/db/prisma.js';

const BAD_IDS = [
  { id: 'cmx0klkds0007if8x1anwevi6', note: 'hanseoa PENDING 좀비 bodies — 공식 풀' },
  { id: 'cmwul2kno002uifqw2jt74s9h', note: 'pikk 11-24 유령 APPROVED — 공식 풀' },
];
for (const { id, note } of BAD_IDS) {
  const p = await prisma.post.findUnique({
    where: { id },
    select: { state: true, generatedBody: true, account: { select: { handle: true } } },
  });
  if (!p) { console.log(`${id}: NOT FOUND`); continue; }
  await prisma.post.update({
    where: { id },
    data: { state: 'REJECTED', rejectionReason: `${note} — 2026-11-29 정리` },
  });
  console.log(`REJECT @${p.account.handle} [${p.state}] "${p.generatedBody}"`);
}
process.exit(0);
