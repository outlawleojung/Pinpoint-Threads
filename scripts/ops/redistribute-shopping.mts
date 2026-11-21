import { prisma } from '../../src/db/prisma.js';

// 대기 중인 쇼핑 포스트 전부 확인
const pending = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL' },
  select: { id: true, generatedBody: true, account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

console.log(`대기 중 쇼핑 포스트: ${pending.length}건\n`);
for (const p of pending) {
  const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 60);
  console.log(`  @${p.account.handle.padEnd(16)} ${body}`);
}

// 4계정으로 분산
const handles = ['pikkseetem', 'minyoung.jung', 'hanseoa.pick', 'kle0_lee'];
const accountMap = new Map<string, string>();
for (const h of handles) {
  const acc = await prisma.account.findFirst({ where: { handle: h, isActive: true } });
  if (acc) accountMap.set(h, acc.id);
}

// 균등 배분: 라운드 로빈
console.log(`\n재배정 (4계정 라운드 로빈):`);
for (let i = 0; i < pending.length; i++) {
  const p = pending[i]!;
  const targetHandle = handles[i % handles.length]!;
  const targetId = accountMap.get(targetHandle)!;

  if (p.account.handle !== targetHandle) {
    await prisma.post.update({ where: { id: p.id }, data: { accountId: targetId } });
  }
  const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 50);
  console.log(`  ${i + 1}. @${targetHandle.padEnd(16)} ${p.account.handle !== targetHandle ? `(← @${p.account.handle})` : '(유지)'} | ${body}`);
}

// 최종 배분 확인
const final: Record<string, number> = {};
for (const h of handles) {
  const c = await prisma.post.count({
    where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL', accountId: accountMap.get(h) },
  });
  final[h] = c;
}
console.log('\n최종 배분:');
for (const [h, c] of Object.entries(final)) console.log(`  @${h}: ${c}건`);

await prisma.$disconnect();
