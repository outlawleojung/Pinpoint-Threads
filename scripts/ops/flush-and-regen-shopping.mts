import { prisma } from '../../src/db/prisma.js';

// 1. 현재 대기 중인 쇼핑 포스트 조회
const pending = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  include: {
    account: { select: { handle: true } },
    sourceItem: { select: { id: true, rawText: true, authorHandle: true } },
  },
  orderBy: { scheduledAt: 'asc' },
});

console.log(`=== 쇼핑 폐기 대상: ${pending.length}건 ===\n`);
for (const p of pending) {
  const sched = p.scheduledAt?.toISOString().slice(5, 16).replace('T', ' ') ?? '미정';
  const body = (p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 50);
  console.log(`  ${p.state.padEnd(18)} @${p.account.handle.padEnd(16)} [${sched}] ${body}`);
}

if (pending.length === 0) {
  console.log('폐기할 쇼핑 포스트 없음.');
  await prisma.$disconnect();
  process.exit(0);
}

// 2. 모든 대기 쇼핑 포스트 REJECTED 처리 (프롬프트 개편으로 폐기)
const discarded = await prisma.post.updateMany({
  where: { id: { in: pending.map(p => p.id) } },
  data: { state: 'REJECTED' },
});
console.log(`\n✅ ${discarded.count}건 REJECTED 처리 완료`);

// 3. 소스 아이템 복원 (재생성 가능하도록)
const sourceIds = pending.map(p => p.sourceItem?.id).filter((id): id is string => !!id);
if (sourceIds.length > 0) {
  const restored = await prisma.sourceItem.updateMany({
    where: { id: { in: sourceIds } },
    data: { usedInPostId: null },
  });
  console.log(`✅ ${restored.count}건 소스 아이템 usedInPostId 해제 (재사용 가능)`);
}

console.log('\n폐기 완료. 새 프롬프트로 재생성은 서버의 쇼핑 크론이 자동 처리합니다.');
console.log('수동 즉시 생성이 필요하면 별도 스크립트를 실행하세요.');

await prisma.$disconnect();
