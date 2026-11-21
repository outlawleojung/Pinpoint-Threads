import { prisma } from '../../src/db/prisma.js';

const pending = await prisma.post.findMany({
  where: { state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  select: { kind: true, state: true, account: { select: { handle: true } }, generatedBody: true },
  orderBy: [{ account: { handle: 'asc' } }, { kind: 'asc' }],
});

console.log(`대기 중 총 ${pending.length}건\n`);

let current = '';
for (const p of pending) {
  if (p.account.handle !== current) {
    current = p.account.handle;
    console.log(`\n@${current}:`);
  }
  const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 65);
  console.log(`  ${p.kind.padEnd(10)} ${p.state.padEnd(18)} ${body}`);
}

await prisma.$disconnect();
