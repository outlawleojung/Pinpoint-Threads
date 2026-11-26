import { prisma } from '../../src/db/prisma.js';
const since = new Date('2026-11-20T00:00:00+09:00');

// 쇼핑 — 모든 상태 (PENDING 포함, REJECTED/FAILED 제외) · scheduledAt/publishedAt 기준
const posts = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    createdAt: { gte: since },
    state: { in: ['PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PUBLISHING', 'CLASSIFYING', 'MATCHING', 'COPYWRITING'] },
  },
  select: {
    id: true, state: true, scheduledAt: true, publishedAt: true, createdAt: true,
    account: { select: { handle: true } },
  },
  orderBy: { scheduledAt: 'asc' },
});

// 계정별 발행일/예정일 기준 그룹
const byAcct: Record<string, { day: string; state: string; when: string; sch: Date | null; pub: Date | null }[]> = {};
for (const p of posts) {
  const when = p.publishedAt ?? p.scheduledAt;
  if (!when) continue;  // 아직 스케줄 없는 건 제외
  const h = p.account.handle;
  const day = when.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' });
  const timeStr = when.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  (byAcct[h] ??= []).push({ day, state: p.state, when: timeStr, sch: p.scheduledAt, pub: p.publishedAt });
}

for (const [h, arr] of Object.entries(byAcct)) {
  console.log(`\n@${h} (${arr.length}건, scheduledAt/publishedAt 기준):`);
  // 날짜별 집계
  const dayMap = new Map<string, string[]>();
  for (const a of arr) (dayMap.get(a.day) ?? dayMap.set(a.day, []).get(a.day)!).push(`${a.state}@${a.when}`);
  const days = [...dayMap.keys()].sort();
  for (const d of days) {
    const states = dayMap.get(d)!;
    const mark = states.length > 1 ? ' ⚠️ 같은날 중복' : '';
    console.log(`  ${d}: ${states.length}건${mark} — ${states.join(', ')}`);
  }
  for (let i = 1; i < days.length; i++) {
    const [m1, d1] = days[i-1]!.split('.').map(s => parseInt(s));
    const [m2, d2] = days[i]!.split('.').map(s => parseInt(s));
    const date1 = new Date(2026, m1!-1, d1!);
    const date2 = new Date(2026, m2!-1, d2!);
    const diff = (date2.getTime() - date1.getTime()) / 864e5;
    if (diff < 2 && h !== 'pikkseetem') {
      console.log(`  ⚠️ 격일 위반: ${days[i-1]} → ${days[i]}`);
    }
  }
}

await prisma.$disconnect();
