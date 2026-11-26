import { prisma } from '../../src/db/prisma.js';
import { PostKind, PostState } from '@prisma/client';

// ═══════════════════════════════════════════════════════
// 1) 전체 성과 리포트
// ═══════════════════════════════════════════════════════
console.log('═══════════════════════════════════════════════════════');
console.log('📊 현재까지 전체 성과 리포트');
console.log('═══════════════════════════════════════════════════════\n');

// 계정별 팔로워
const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true, followersCount: true },
  orderBy: { followersCount: 'desc' },
});

console.log('👥 계정별 팔로워:');
for (const a of accounts) {
  console.log(`  @${a.handle.padEnd(18)} ${a.followersCount ?? '?'}명`);
}

// 계정별 발행 통계 (전체)
console.log('\n📈 계정별 발행 통계 (전체):');
for (const a of accounts) {
  const byKind = await prisma.post.groupBy({
    by: ['kind'],
    where: { accountId: a.id, state: 'PUBLISHED' },
    _count: true,
  });
  const summary = byKind.map(g => `${g.kind}:${g._count}`).join(' / ') || '없음';
  const total = byKind.reduce((s, g) => s + g._count, 0);
  console.log(`  @${a.handle.padEnd(18)} 총 ${total}건 — ${summary}`);
}

// 최근 7일 발행 통계
console.log('\n📅 최근 7일 발행:');
const weekAgo = new Date(Date.now() - 7 * 864e5);
for (const a of accounts) {
  const byKind = await prisma.post.groupBy({
    by: ['kind'],
    where: { accountId: a.id, state: 'PUBLISHED', publishedAt: { gte: weekAgo } },
    _count: true,
  });
  const summary = byKind.map(g => `${g.kind}:${g._count}`).join(' / ') || '없음';
  const total = byKind.reduce((s, g) => s + g._count, 0);
  console.log(`  @${a.handle.padEnd(18)} ${total}건 — ${summary}`);
}

// 최근 7일 도달(조회수) — 종류별
console.log('\n👁️ 최근 7일 도달(조회수):');
for (const a of accounts) {
  const posts = await prisma.post.findMany({
    where: { accountId: a.id, state: 'PUBLISHED', publishedAt: { gte: weekAgo } },
    select: {
      kind: true,
      insightSnapshots: { select: { views: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
    },
  });
  const byKind: Record<string, number[]> = {};
  for (const p of posts) {
    const v = p.insightSnapshots[0]?.views;
    if (v != null) {
      if (!byKind[p.kind]) byKind[p.kind] = [];
      byKind[p.kind]!.push(v);
    }
  }
  const parts: string[] = [];
  for (const [kind, vals] of Object.entries(byKind)) {
    vals.sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)] ?? 0;
    const max = vals[vals.length - 1] ?? 0;
    const sum = vals.reduce((s, v) => s + v, 0);
    parts.push(`${kind}: 중앙값${med} 최대${max} 합계${sum} (${vals.length}건)`);
  }
  console.log(`  @${a.handle.padEnd(18)} ${parts.join(' | ') || '데이터 없음'}`);
}

// 쇼핑 성과 (클릭·전환)
console.log('\n🛍️ 쇼핑 발행 성과 (최근 14일):');
const twoWeeksAgo = new Date(Date.now() - 14 * 864e5);
const shoppingPosts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PUBLISHED', publishedAt: { gte: twoWeeksAgo } },
  select: {
    account: { select: { handle: true } },
    publishedAt: true,
    generatedBody: true,
    insightSnapshots: { select: { views: true, likes: true, replies: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
  },
  orderBy: { publishedAt: 'desc' },
});
for (const p of shoppingPosts) {
  const snap = p.insightSnapshots[0];
  const date = p.publishedAt?.toISOString().slice(5, 10) ?? '?';
  const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 50);
  console.log(`  [${date}] @${p.account.handle.padEnd(16)} 👁️${snap?.views ?? '?'} ❤️${snap?.likes ?? '?'} 💬${snap?.replies ?? '?'} | ${body}`);
}

// 스하리 성과
console.log('\n📢 스하리 발행 성과 (최근 7일):');
const sharingPosts = await prisma.post.findMany({
  where: { kind: 'SHARING', state: 'PUBLISHED', publishedAt: { gte: weekAgo } },
  select: {
    account: { select: { handle: true } },
    publishedAt: true,
    generatedBody: true,
    insightSnapshots: { select: { views: true, likes: true, replies: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
  },
  orderBy: { publishedAt: 'desc' },
});
for (const p of sharingPosts) {
  const snap = p.insightSnapshots[0];
  const date = p.publishedAt?.toISOString().slice(5, 10) ?? '?';
  const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 60);
  console.log(`  [${date}] @${p.account.handle.padEnd(16)} 👁️${snap?.views ?? '?'} ❤️${snap?.likes ?? '?'} 💬${snap?.replies ?? '?'} | ${body}`);
}

// 일상글 성과
console.log('\n🌿 일상글 발행 성과 (최근 7일):');
const dailyPosts = await prisma.post.findMany({
  where: { kind: 'DAILY', state: 'PUBLISHED', publishedAt: { gte: weekAgo } },
  select: {
    account: { select: { handle: true } },
    publishedAt: true,
    generatedBody: true,
    insightSnapshots: { select: { views: true, likes: true, replies: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
  },
  orderBy: { publishedAt: 'desc' },
});
for (const p of dailyPosts) {
  const snap = p.insightSnapshots[0];
  const date = p.publishedAt?.toISOString().slice(5, 10) ?? '?';
  const body = (p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 60);
  console.log(`  [${date}] @${p.account.handle.padEnd(16)} 👁️${snap?.views ?? '?'} ❤️${snap?.likes ?? '?'} 💬${snap?.replies ?? '?'} | ${body}`);
}

// ═══════════════════════════════════════════════════════
// 2) 대기 중 스하리 전부 폐기
// ═══════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════════════');
console.log('🗑️ 대기 중 스하리 폐기');
console.log('═══════════════════════════════════════════════════════\n');

const cancelled = await prisma.post.updateMany({
  where: {
    kind: 'SHARING',
    state: { in: ['PENDING_APPROVAL', 'APPROVED'] },
  },
  data: {
    state: PostState.REJECTED,
    rejectionReason: '카피 품질 개선 위해 일괄 폐기 (2026-11-21)',
  },
});
console.log(`✅ ${cancelled.count}건 스하리 폐기 완료\n`);

// ═══════════════════════════════════════════════════════
// 3) 새 스하리 발행
// ═══════════════════════════════════════════════════════
console.log('═══════════════════════════════════════════════════════');
console.log('🔄 새 스하리 발행 (개선된 카피)');
console.log('═══════════════════════════════════════════════════════\n');

const { runSharingForAllAccounts } = await import('../../src/modules/pipeline-b/sharing-publisher/orchestrator.js');
const results = await runSharingForAllAccounts();
for (const r of results) {
  if (r.status === 'ok') {
    for (const v of r.variants ?? []) {
      const body = (v.body ?? '').replace(/\n/g, ' / ').slice(0, 80);
      console.log(`  ✅ @${r.handle?.padEnd(16)} [${v.hookLabel}] ${body}`);
    }
  } else {
    console.log(`  ❌ @${r.handle ?? '?'} — ${r.reason ?? r.status}`);
  }
}

await prisma.$disconnect();
