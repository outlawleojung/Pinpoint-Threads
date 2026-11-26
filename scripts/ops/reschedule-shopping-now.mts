import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

console.log(`APPROVED 쇼핑 ${posts.length}건 수동 스케줄\n`);

// 계정별 격일, 오전 9~11시, 계정 간 30분+ 시차
// sookck.kate, pikkseetem 두 계정
const schedule: { id: string; handle: string; date: string; hour: number; min: number }[] = [];
const kateIdx: number[] = [];
const pikkIdx: number[] = [];

posts.forEach((p, i) => {
  if (p.account.handle === 'sookck.kate') kateIdx.push(i);
  else pikkIdx.push(i);
});

// 11/12부터 격일 배분
let kateDay = 12; // 11/12, 14, 16...
let pikkDay = 13; // 11/13, 15, 17...

for (const i of kateIdx) {
  const min = 5 + Math.floor(Math.random() * 50);
  schedule.push({ id: posts[i].id, handle: 'sookck.kate', date: `2026-11-${kateDay}`, hour: 9, min });
  kateDay += 2;
}
for (const i of pikkIdx) {
  const min = 5 + Math.floor(Math.random() * 50);
  schedule.push({ id: posts[i].id, handle: 'pikkseetem', date: `2026-11-${pikkDay}`, hour: 9, min });
  pikkDay += 2;
}

for (const s of schedule) {
  const dt = new Date(`${s.date}T${String(s.hour).padStart(2,'0')}:${String(s.min).padStart(2,'0')}:00+09:00`);
  await prisma.post.update({ where: { id: s.id }, data: { scheduledAt: dt } });
  console.log(`✅ ${s.handle.padEnd(15)} → ${dt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
}

await prisma.$disconnect();
