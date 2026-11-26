import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  select: { id: true, scheduledAt: true, account: { select: { handle: true } }, generatedBody: true },
  orderBy: { createdAt: 'asc' },
});

// scheduledAt 있는 것과 없는 것 분리
const scheduled = posts.filter(p => p.scheduledAt);
const unscheduled = posts.filter(p => !p.scheduledAt);
console.log(`총 ${posts.length}건 — 스케줄 있음: ${scheduled.length}, 없음: ${unscheduled.length}\n`);

// 기존 스케줄 날짜 확인
const takenDates = new Map<string, Set<string>>(); // handle -> Set<'11/12', '11/13', ...>
for (const p of scheduled) {
  const d = new Date(p.scheduledAt!);
  const day = `${d.getMonth()+1}/${d.getDate()}`;
  const handle = p.account.handle;
  if (!takenDates.has(handle)) takenDates.set(handle, new Set());
  takenDates.get(handle)!.add(day);
  const t = d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`기존: ${handle.padEnd(15)} | ${t}`);
}

console.log('');

// 미스케줄 포스트에 날짜 배정
// 계정별 격일, 기존 날짜 피해서
const kateUnscheduled = unscheduled.filter(p => p.account.handle === 'sookck.kate');
const pikkUnscheduled = unscheduled.filter(p => p.account.handle === 'pikkseetem');

const kateTaken = takenDates.get('sookck.kate') ?? new Set();
const pikkTaken = takenDates.get('pikkseetem') ?? new Set();

function findNextDays(taken: Set<string>, count: number, startDay: number): number[] {
  const days: number[] = [];
  let d = startDay;
  while (days.length < count && d <= 30) {
    const key = `11/${d}`;
    // 격일: 이전 배정일과 1일 이상 차이
    const prevDay = days.length > 0 ? days[days.length - 1] : 0;
    if (!taken.has(key) && (prevDay === 0 || d - prevDay >= 2)) {
      days.push(d);
      taken.add(key);
    }
    d++;
  }
  return days;
}

// 기존 최대 날짜 이후부터 시작
const kateMaxDay = Math.max(...[...kateTaken].map(s => parseInt(s.split('/')[1])), 11);
const pikkMaxDay = Math.max(...[...pikkTaken].map(s => parseInt(s.split('/')[1])), 11);

const kateDays = findNextDays(kateTaken, kateUnscheduled.length, kateMaxDay + 1);
const pikkDays = findNextDays(pikkTaken, pikkUnscheduled.length, pikkMaxDay + 1);

for (let i = 0; i < kateUnscheduled.length; i++) {
  const min = 5 + Math.floor(Math.random() * 50);
  const dt = new Date(`2026-11-${kateDays[i]}T09:${String(min).padStart(2,'0')}:00+09:00`);
  await prisma.post.update({ where: { id: kateUnscheduled[i].id }, data: { scheduledAt: dt } });
  const t = dt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const body = (kateUnscheduled[i].generatedBody || '').slice(0, 35).replace(/\n/g, ' ');
  console.log(`✅ sookck.kate     → ${t} | ${body}`);
}

for (let i = 0; i < pikkUnscheduled.length; i++) {
  const min = 5 + Math.floor(Math.random() * 50);
  const dt = new Date(`2026-11-${pikkDays[i]}T09:${String(min).padStart(2,'0')}:00+09:00`);
  await prisma.post.update({ where: { id: pikkUnscheduled[i].id }, data: { scheduledAt: dt } });
  const t = dt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const body = (pikkUnscheduled[i].generatedBody || '').slice(0, 35).replace(/\n/g, ' ');
  console.log(`✅ pikkseetem      → ${t} | ${body}`);
}

// 최종 전체 확인
console.log('\n--- 최종 스케줄 ---');
const all = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED' },
  select: { account: { select: { handle: true } }, scheduledAt: true, generatedBody: true },
  orderBy: { scheduledAt: 'asc' },
});
for (const p of all) {
  const t = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미정';
  const body = (p.generatedBody || '').slice(0, 40).replace(/\n/g, ' ');
  console.log(`${p.account.handle.padEnd(15)} | ${t} | ${body}`);
}

await prisma.$disconnect();
