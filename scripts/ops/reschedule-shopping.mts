import { prisma } from '../../src/db/prisma.js';
import { computeManualPublishSchedule } from '../../src/modules/shared/publisher/scheduler.js';

// 1. 현재 예약된 쇼핑 포스트 조회
const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: { in: ['APPROVED', 'PENDING_APPROVAL'] } },
  include: { account: { select: { handle: true } } },
  orderBy: { scheduledAt: 'asc' },
});

console.log(`=== 현재 쇼핑 ${posts.length}건 ===\n`);
for (const p of posts) {
  const sched = p.scheduledAt ? p.scheduledAt.toISOString().slice(5, 16).replace('T', ' ') : 'NULL';
  console.log(`  [${p.state.padEnd(16)}] @${p.account.handle.padEnd(16)} ${sched}  ${(p.generatedBody ?? '').slice(0, 40)}`);
}

// 2. APPROVED 포스트만 새 스케줄러로 재배당
const approved = posts.filter(p => p.state === 'APPROVED');
console.log(`\n=== APPROVED ${approved.length}건 재배당 ===\n`);

for (const p of approved) {
  try {
    const sched = await computeManualPublishSchedule(p.accountId, 'SHOPPING', { excludePostId: p.id });
    await prisma.post.update({
      where: { id: p.id },
      data: { scheduledAt: sched.targetTime },
    });
    const old = p.scheduledAt ? p.scheduledAt.toISOString().slice(5, 16).replace('T', ' ') : 'NULL';
    const nw = sched.targetTime.toISOString().slice(5, 16).replace('T', ' ');
    console.log(`  ✅ @${p.account.handle.padEnd(16)} ${old} → ${nw}  ${(p.generatedBody ?? '').slice(0, 30)}`);
  } catch (e: any) {
    console.log(`  ❌ @${p.account.handle.padEnd(16)} ${e.message}`);
  }
}

// 3. 결과 확인
console.log(`\n=== 재배당 후 결과 ===\n`);
const after = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'APPROVED', scheduledAt: { not: null } },
  include: { account: { select: { handle: true } } },
  orderBy: { scheduledAt: 'asc' },
});
for (const p of after) {
  const sched = p.scheduledAt!.toISOString().slice(5, 16).replace('T', ' ');
  console.log(`  @${p.account.handle.padEnd(16)} ${sched}  ${(p.generatedBody ?? '').slice(0, 40)}`);
}

await prisma.$disconnect();
