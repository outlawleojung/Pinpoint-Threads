import { prisma } from '../../src/db/prisma.js';

// 1) 잘못 리젝된 승인 포스트 복구
const restore = await prisma.post.updateMany({
  where: { kind: 'SHARING', state: 'REJECTED', rejectionReason: '프롬프트 개선 전 생성분' },
  data: { state: 'APPROVED', rejectionReason: null },
});
console.log('복구:', restore.count, '건');

// 2) 방금 생성된 쓰레기 PENDING 카드 전부 리젝
const reject = await prisma.post.updateMany({
  where: { kind: 'SHARING', state: 'PENDING_APPROVAL' },
  data: { state: 'REJECTED', rejectionReason: '맥락 없는 문구 — 전면 재작업' },
});
console.log('리젝:', reject.count, '건');

// 3) 현재 상태 확인
const active = await prisma.post.findMany({
  where: { kind: 'SHARING', state: { in: ['APPROVED', 'PENDING_APPROVAL'] } },
  select: { state: true, generatedBody: true, account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
console.log('\n현재 활성:');
for (const a of active) console.log(`[${a.state}] @${a.account.handle}: ${a.generatedBody?.replace(/\n/g, ' | ').slice(0, 70)}`);

await prisma.$disconnect();
