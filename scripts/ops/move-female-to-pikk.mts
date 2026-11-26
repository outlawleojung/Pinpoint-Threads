import { prisma } from '../../src/db/prisma.js';

const pikk = await prisma.account.findFirst({ where: { handle: 'pikkseetem' }, select: { id: true } });
if (!pikk) { console.log('❌'); process.exit(1); }

// minyoung.jung에 있는 여성 상품 3건 찾기
const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED', account: { handle: 'minyoung.jung' } },
  select: { id: true, generatedBody: true, scheduledAt: true },
});

for (const p of posts) {
  const body = p.generatedBody || '';
  const isFemale = body.includes('헌터') || body.includes('하이탑') || body.includes('실내화');
  if (isFemale) {
    await prisma.post.update({ where: { id: p.id }, data: { accountId: pikk.id } });
    const t = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미정';
    console.log(`✅ → pikkseetem | ${t} | ${body.slice(0, 40).replace(/\n/g, ' ')}`);
  }
}

// 최종 확인
console.log('\n--- 최종 스케줄 ---');
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
