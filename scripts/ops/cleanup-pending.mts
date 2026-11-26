import { prisma } from '../../src/db/prisma.js';

// 이번 세션 카드 발송 완료 건 (유지)
const keep = new Set([
  'cmvur6qq200018c4m35bsmr6d', // 고양이배 sookck.kate
  'cmvus0jlb00018ce2md2m6pc1', // 새끼고양이 minyoung.jung
  'cmvus9fq700028cniz4bkiqq5', // 나이키 sookck.kate
  'cmvuse8hi00028clfwj1626gi', // 뉴발란스 pikkseetem
]);

const pending = await prisma.post.findMany({
  where: { state: 'PENDING_APPROVAL' },
  include: { account: { select: { handle: true } } },
});

let rejected = 0;
for (const p of pending) {
  if (keep.has(p.id)) {
    console.log(`유지: [${p.account.handle}] ${p.kind} "${(p.generatedBody ?? '').slice(0, 40)}"`);
    continue;
  }
  
  let reason = '';
  if (p.kind === 'SHARING') {
    reason = '스하리 카피 품질 불량 + 미디어 없음 일괄 정리';
  } else {
    reason = '시의성 경과 일괄 정리';
  }

  await prisma.post.update({
    where: { id: p.id },
    data: { state: 'REJECTED', rejectionReason: reason },
  });
  console.log(`REJECTED: [${p.account.handle}] ${p.kind} "${(p.generatedBody ?? '').slice(0, 40)}" — ${reason}`);
  rejected++;
}

console.log(`\n완료: ${rejected}건 폐기, ${keep.size}건 유지`);
await prisma.$disconnect();
