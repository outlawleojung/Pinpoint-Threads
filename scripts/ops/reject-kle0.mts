import { prisma } from '../../src/db/prisma.js';

await prisma.post.update({
  where: { id: 'cmvuv29u20001ifgma5bhozm7' },
  data: { state: 'REJECTED', rejectionReason: '엉뚱한 훅(개발 일지) + 미디어 0개' },
});
console.log('REJECTED 처리 완료');

// 이전 PENDING_APPROVAL 스하리들도 확인
const acc = await prisma.account.findFirst({ where: { handle: { contains: 'kle0' } } });
const pendingSharing = await prisma.post.findMany({
  where: { accountId: acc!.id, kind: 'SHARING', state: 'PENDING_APPROVAL' },
  select: { id: true, generatedBody: true, createdAt: true },
});
console.log(`\n남은 PENDING 스하리: ${pendingSharing.length}건`);
for (const p of pendingSharing) {
  console.log(`  ${p.id} | ${p.createdAt.toISOString().slice(0,10)} | "${(p.generatedBody ?? '').slice(0,50)}"`);
}

await prisma.$disconnect();
