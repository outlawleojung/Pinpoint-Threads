import { prisma } from '../../src/db/prisma.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('📊 Pinpoint Threads 전체 성과 리포트 (2026-11-21)');
console.log('═══════════════════════════════════════════════════════════════\n');

// ── 1. 계정 현황 ──
const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true, followersCount: true, createdAt: true },
  orderBy: { followersCount: 'desc' },
});

console.log('1️⃣  계정 현황');
console.log('─'.repeat(60));
for (const a of accounts) {
  const age = Math.floor((Date.now() - a.createdAt.getTime()) / 864e5);
  console.log(`  @${a.handle.padEnd(18)} 팔로워 ${String(a.followersCount ?? 0).padStart(4)}명  (${age}일)`);
}
const totalFollowers = accounts.reduce((s, a) => s + (a.followersCount ?? 0), 0);
console.log(`  ${'합계'.padEnd(19)} ${totalFollowers}명\n`);

// ── 2. 전체 발행 통계 ──
console.log('2️⃣  전체 발행 통계');
console.log('─'.repeat(60));
const allPosts = await prisma.post.groupBy({
  by: ['kind', 'state'],
  _count: true,
});
const kindTotals: Record<string, Record<string, number>> = {};
for (const g of allPosts) {
  if (!kindTotals[g.kind]) kindTotals[g.kind] = {};
  kindTotals[g.kind]![g.state] = g._count;
}
for (const [kind, states] of Object.entries(kindTotals)) {
  const pub = states['PUBLISHED'] ?? 0;
  const fail = states['FAILED'] ?? 0;
  const rej = states['REJECTED'] ?? 0;
  const pend = states['PENDING_APPROVAL'] ?? 0;
  const appr = states['APPROVED'] ?? 0;
  const total = Object.values(states).reduce((s, v) => s + v, 0);
  console.log(`  ${kind.padEnd(12)} 발행${String(pub).padStart(4)} / 실패${String(fail).padStart(4)} / 리젝${String(rej).padStart(4)} / 대기${String(pend + appr).padStart(4)} (총${total})`);
}

// ── 3. 주차별 발행 추이 ──
console.log('\n3️⃣  주차별 발행 추이 (최근 4주)');
console.log('─'.repeat(60));
for (let w = 3; w >= 0; w--) {
  const start = new Date(Date.now() - (w + 1) * 7 * 864e5);
  const end = new Date(Date.now() - w * 7 * 864e5);
  const label = `${start.toISOString().slice(5,10)}~${end.toISOString().slice(5,10)}`;
  const weekPosts = await prisma.post.groupBy({
    by: ['kind'],
    where: { state: 'PUBLISHED', publishedAt: { gte: start, lt: end } },
    _count: true,
  });
  const parts = weekPosts.map(g => `${g.kind}:${g._count}`).join(' ');
  const total = weekPosts.reduce((s, g) => s + g._count, 0);
  console.log(`  ${label}  ${String(total).padStart(3)}건  ${parts}`);
}

// ── 4. 도달(조회수) 전체 ──
console.log('\n4️⃣  도달(조회수) — 종류별 전체');
console.log('─'.repeat(60));
for (const kind of ['DAILY', 'SHARING', 'SHOPPING'] as const) {
  const posts = await prisma.post.findMany({
    where: { state: 'PUBLISHED', kind },
    select: { insightSnapshots: { select: { views: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 } },
  });
  const vals = posts.map(p => p.insightSnapshots[0]?.views).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
  if (vals.length === 0) { console.log(`  ${kind.padEnd(12)} 데이터 없음`); continue; }
  const med = vals[Math.floor(vals.length / 2)]!;
  const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  const max = vals[vals.length - 1]!;
  const sum = vals.reduce((s, v) => s + v, 0);
  const over1k = vals.filter(v => v >= 1000).length;
  console.log(`  ${kind.padEnd(12)} ${vals.length}건 | 중앙값 ${med} | 평균 ${avg} | 최대 ${max} | 합계 ${sum.toLocaleString()} | 1000+뷰 ${over1k}건`);
}

// ── 5. TOP 10 터진 글 ──
console.log('\n5️⃣  역대 TOP 10 (조회수)');
console.log('─'.repeat(60));
const topPosts = await prisma.post.findMany({
  where: { state: 'PUBLISHED' },
  select: {
    kind: true,
    publishedAt: true,
    generatedBody: true,
    account: { select: { handle: true } },
    insightSnapshots: { select: { views: true, likes: true, replies: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
  },
});
const scored = topPosts
  .map(p => ({ ...p, views: p.insightSnapshots[0]?.views ?? 0 }))
  .sort((a, b) => b.views - a.views)
  .slice(0, 10);
for (const p of scored) {
  const snap = p.insightSnapshots[0];
  const date = p.publishedAt?.toISOString().slice(5, 10) ?? '?';
  const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 55);
  console.log(`  ${String(p.views).padStart(6)}뷰 ❤️${String(snap?.likes ?? 0).padStart(3)} 💬${String(snap?.replies ?? 0).padStart(2)} [${date}] @${p.account.handle.padEnd(16)} ${p.kind.padEnd(8)} ${body}`);
}

// ── 6. 계정별 도달 추이 (최근 4주, 일상글 기준) ──
console.log('\n6️⃣  계정별 일상글 도달 추이 (주간 중앙값)');
console.log('─'.repeat(60));
for (const a of accounts) {
  const parts: string[] = [];
  for (let w = 3; w >= 0; w--) {
    const start = new Date(Date.now() - (w + 1) * 7 * 864e5);
    const end = new Date(Date.now() - w * 7 * 864e5);
    const posts = await prisma.post.findMany({
      where: { accountId: a.id, state: 'PUBLISHED', kind: 'DAILY', publishedAt: { gte: start, lt: end } },
      select: { insightSnapshots: { select: { views: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 } },
    });
    const vals = posts.map(p => p.insightSnapshots[0]?.views).filter((v): v is number => v != null).sort((a, b) => a - b);
    const med = vals.length > 0 ? vals[Math.floor(vals.length / 2)]! : 0;
    parts.push(`${med}`);
  }
  console.log(`  @${a.handle.padEnd(18)} ${parts.join(' → ')}`);
}

// ── 7. 쇼핑 성과 상세 ──
console.log('\n7️⃣  쇼핑 발행 전체 성과');
console.log('─'.repeat(60));
const allShopping = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PUBLISHED' },
  select: {
    account: { select: { handle: true } },
    publishedAt: true,
    generatedBody: true,
    insightSnapshots: { select: { views: true, likes: true, replies: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
  },
  orderBy: { publishedAt: 'desc' },
});
console.log(`  총 ${allShopping.length}건 발행`);
const shopByAccount: Record<string, { count: number; views: number[]; likes: number[] }> = {};
for (const p of allShopping) {
  const h = p.account.handle;
  if (!shopByAccount[h]) shopByAccount[h] = { count: 0, views: [], likes: [] };
  shopByAccount[h]!.count++;
  const v = p.insightSnapshots[0]?.views;
  if (v != null) shopByAccount[h]!.views.push(v);
  const l = p.insightSnapshots[0]?.likes;
  if (l != null) shopByAccount[h]!.likes.push(l);
}
for (const [h, d] of Object.entries(shopByAccount)) {
  d.views.sort((a, b) => a - b);
  const med = d.views.length > 0 ? d.views[Math.floor(d.views.length / 2)]! : 0;
  const max = d.views.length > 0 ? d.views[d.views.length - 1]! : 0;
  const sum = d.views.reduce((s, v) => s + v, 0);
  console.log(`  @${h.padEnd(18)} ${d.count}건 | 중앙값 ${med}뷰 | 최대 ${max}뷰 | 합계 ${sum.toLocaleString()}뷰`);
}

// ── 8. 실패율 ──
console.log('\n8️⃣  실패율 (전체)');
console.log('─'.repeat(60));
const stateCount = await prisma.post.groupBy({
  by: ['state'],
  _count: true,
});
const stateMap = Object.fromEntries(stateCount.map(g => [g.state, g._count]));
const totalPosts = Object.values(stateMap).reduce((s, v) => s + v, 0);
const published = stateMap['PUBLISHED'] ?? 0;
const failed = stateMap['FAILED'] ?? 0;
const rejected = stateMap['REJECTED'] ?? 0;
console.log(`  총 ${totalPosts}건 | 발행 ${published} (${Math.round(published/totalPosts*100)}%) | 실패 ${failed} (${Math.round(failed/totalPosts*100)}%) | 리젝 ${rejected} (${Math.round(rejected/totalPosts*100)}%)`);

// ── 9. 오늘 대기 ──
console.log('\n9️⃣  현재 대기 중');
console.log('─'.repeat(60));
const pending = await prisma.post.findMany({
  where: { state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  select: { kind: true, account: { select: { handle: true } }, generatedBody: true },
});
if (pending.length === 0) {
  console.log('  없음');
} else {
  for (const p of pending) {
    const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 60);
    console.log(`  ${p.kind.padEnd(10)} @${p.account.handle.padEnd(16)} ${body}`);
  }
}

await prisma.$disconnect();
