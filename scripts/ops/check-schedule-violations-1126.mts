// 현재 승인·대기 중인 스하리·쇼핑 중 격일 위반 찾기
import { prisma } from '../../src/db/prisma.js';

const now = new Date();
const since = new Date('2026-11-20T00:00:00+09:00');

// 1. 스하리 — 전 계정 격일
console.log('=== 스하리 격일 위반 체크 ===\n');
for (const handle of ['pikkseetem', 'minyoung.jung', 'hanseoa.pick', 'kle0_lee']) {
  const acc = await prisma.account.findFirst({ where: { handle } });
  if (!acc) continue;
  const posts = await prisma.post.findMany({
    where: {
      kind: 'SHARING',
      accountId: acc.id,
      state: { in: ['PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PUBLISHING'] },
      createdAt: { gte: since },
    },
    select: { id: true, state: true, scheduledAt: true, publishedAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const dates = posts.map(p => {
    const when = p.publishedAt ?? p.scheduledAt ?? p.createdAt;
    return { id: p.id, state: p.state, date: when.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) };
  });
  const dayMap = new Map<string, typeof dates>();
  for (const d of dates) {
    const arr = dayMap.get(d.date) ?? [];
    arr.push(d);
    dayMap.set(d.date, arr);
  }
  console.log(`@${handle}:`);
  for (const [day, arr] of dayMap) console.log(`  ${day}: ${arr.length}건 [${arr.map(a => a.state).join(',')}]`);

  // 연속일 체크
  const sortedDays = [...dayMap.keys()].sort();
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i-1]!);
    const curr = new Date(sortedDays[i]!);
    const diff = (curr.getTime() - prev.getTime()) / 864e5;
    if (diff < 2) {
      console.log(`  ⚠️ 격일 위반: ${sortedDays[i-1]} → ${sortedDays[i]}`);
    }
  }
}

// 2. 쇼핑 — pikkseetem 제외 격일
console.log('\n=== 쇼핑 격일 위반 체크 (pikkseetem 제외) ===\n');
for (const handle of ['minyoung.jung', 'hanseoa.pick', 'kle0_lee']) {
  const acc = await prisma.account.findFirst({ where: { handle } });
  if (!acc) continue;
  const posts = await prisma.post.findMany({
    where: {
      kind: 'SHOPPING',
      accountId: acc.id,
      state: { in: ['PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PUBLISHING'] },
      createdAt: { gte: since },
    },
    select: { state: true, scheduledAt: true, publishedAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const dayMap = new Map<string, string[]>();
  for (const p of posts) {
    const when = p.publishedAt ?? p.scheduledAt ?? p.createdAt;
    const day = when.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    (dayMap.get(day) ?? dayMap.set(day, []).get(day)!).push(p.state);
  }
  console.log(`@${handle}:`);
  for (const [day, states] of dayMap) console.log(`  ${day}: ${states.length}건 [${states.join(',')}]`);
  const sortedDays = [...dayMap.keys()].sort();
  for (let i = 1; i < sortedDays.length; i++) {
    const diff = (new Date(sortedDays[i]!).getTime() - new Date(sortedDays[i-1]!).getTime()) / 864e5;
    if (diff < 2) console.log(`  ⚠️ 격일 위반: ${sortedDays[i-1]} → ${sortedDays[i]}`);
  }
}

await prisma.$disconnect();
