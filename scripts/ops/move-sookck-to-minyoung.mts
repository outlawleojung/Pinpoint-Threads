import { prisma } from '../../src/db/prisma.js';

const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true },
});
console.log('활성 계정:', accounts.map(a => a.handle).join(', '));

const minyoung = accounts.find(a => a.handle.includes('minyoung'));
if (!minyoung) {
  console.log('❌ minyoung 계정 없음. 전체 계정:');
  const all = await prisma.account.findMany({ select: { handle: true, isActive: true } });
  for (const a of all) console.log(`  ${a.handle} (active: ${a.isActive})`);
  process.exit(1);
}
console.log(`\nminyoung: ${minyoung.handle} (${minyoung.id})\n`);

const sookckPosts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED', account: { handle: 'sookck.kate' } },
  select: { id: true, scheduledAt: true, generatedBody: true },
  orderBy: { scheduledAt: 'asc' },
});

console.log(`sookck.kate APPROVED 쇼핑: ${sookckPosts.length}건\n`);

for (const p of sookckPosts) {
  const t = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미정';
  const body = (p.generatedBody || '').slice(0, 40).replace(/\n/g, ' ');
  await prisma.post.update({ where: { id: p.id }, data: { accountId: minyoung.id } });
  console.log(`✅ → ${minyoung.handle} | ${t} | ${body}`);
}

console.log('\n--- 이관 후 전체 쇼핑 스케줄 ---');
const all = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  select: { account: { select: { handle: true } }, scheduledAt: true, generatedBody: true },
  orderBy: { scheduledAt: 'asc' },
});
for (const p of all) {
  const t = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미정';
  const body = (p.generatedBody || '').slice(0, 40).replace(/\n/g, ' ');
  console.log(`${p.account.handle.padEnd(18)} | ${t} | ${body}`);
}

await prisma.$disconnect();
