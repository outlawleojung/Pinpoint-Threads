import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING' },
  select: { state: true },
});
const counts: Record<string, number> = {};
for (const p of posts) counts[p.state] = (counts[p.state] ?? 0) + 1;
console.log('쇼핑 상태:', counts);

// COPYWRITING 멈춤
const stuck = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'COPYWRITING' },
  include: { account: { select: { handle: true } } },
});
if (stuck.length > 0) {
  console.log(`\nCOPYWRITING 멈춤: ${stuck.length}건`);
  for (const p of stuck) {
    const age = Math.round((Date.now() - p.createdAt.getTime()) / 60000);
    console.log(`  @${p.account.handle} — ${age}분 전 생성`);
  }
}

// PENDING_APPROVAL
const pending = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
});
console.log(`\nPENDING_APPROVAL: ${pending.length}건`);
for (const p of pending) {
  const body = (p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 60);
  console.log(`  @${p.account.handle.padEnd(16)} ${body}`);
}

// FAILED 최근 30분
const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
const failed = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'FAILED', createdAt: { gte: thirtyMinAgo } },
  include: { account: { select: { handle: true } } },
});
if (failed.length > 0) {
  console.log(`\n최근 30분 FAILED: ${failed.length}건`);
}

// 최근 비REJECTED/PUBLISHED 포스트
const active = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: { notIn: ['REJECTED', 'PUBLISHED', 'FAILED'] } },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
  take: 10,
});
if (active.length > 0) {
  console.log(`\n활성 쇼핑 포스트 ${active.length}건:`);
  for (const p of active) {
    const body = (p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 60);
    const age = Math.round((Date.now() - p.createdAt.getTime()) / 60000);
    console.log(`  ${p.state.padEnd(18)} @${p.account.handle.padEnd(16)} [${age}분 전] ${body || '(카피 없음)'}`);
  }
}

await prisma.$disconnect();
