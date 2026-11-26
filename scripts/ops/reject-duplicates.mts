import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

// 1상품 = 1계정. APPROVED 기준으로 확정, 중복 폐기.
// 브루클린 카드 재발송 필요.

// 정확한 post ID로 처리
const toReject = [
  'cmw7xr76o00018c8z4wexsr0h', // pikkseetem 헌터 (sookck.kate APPROVED)
  'cmw7xsvsv00038cxzrtoqpr1o', // sookck.kate 아디다스 (pikkseetem APPROVED)
  'cmw7y0ilk00048c2jqvcwefwv', // sookck.kate 에어포스 (pikkseetem APPROVED)
  'cmw7y2fzq00038cco972agqib', // sookck.kate NB로퍼 → pikkseetem 유지
  'cmw7y2n6300058ccopegirbgf', // pikkseetem 브루클린 → sookck.kate 유지
  'cmw7y337700098cco319fr5o8', // pikkseetem 에어로퍼 (sookck.kate APPROVED)
  'cmw7y3hkl000d8cco04vcdaal', // pikkseetem 아식스 (sookck.kate APPROVED)
];

for (const id of toReject) {
  const p = await prisma.post.findUnique({ where: { id }, include: { account: { select: { handle: true } } } });
  if (!p) { console.log(`⚠️ 못 찾음: ${id}`); continue; }
  await prisma.post.update({ where: { id }, data: { state: 'REJECTED' } });
  console.log(`❌ REJECTED: ${p.account.handle} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
}

// 브루클린 sookck.kate 카드 재발송
const brooklynId = 'cmw7y2uxy00078ccoyfwphyvb';
const bp = await prisma.post.findUnique({ where: { id: brooklynId }, include: { account: { select: { handle: true } } } });
if (bp && bp.state === 'PENDING_APPROVAL') {
  console.log(`\n📨 브루클린 sookck.kate 카드 재발송...`);
  await sendApprovalRequest(brooklynId);
  console.log(`✅ 브루클린 카드 발송 완료`);
}

// NB로퍼 pikkseetem 카드 재발송 (혹시 안 왔을 수 있음)
const nbId = 'cmw7y28d200018ccoflqghenp';
const np = await prisma.post.findUnique({ where: { id: nbId }, include: { account: { select: { handle: true } } } });
if (np && np.state === 'PENDING_APPROVAL') {
  console.log(`📨 NB로퍼 pikkseetem 카드 재발송...`);
  await sendApprovalRequest(nbId);
  console.log(`✅ NB로퍼 카드 발송 완료`);
}

// 최종 현황
console.log(`\n=== 유지 중인 쇼핑 포스트 ===`);
const remaining = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    state: { not: 'REJECTED' },
    createdAt: { gte: new Date(Date.now() - 12 * 3600000) },
  },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

for (const p of remaining) {
  const body = (p.generatedBody ?? '').slice(0, 50).replace(/\n/g, ' ');
  const sched = p.scheduledAt
    ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
    : '-';
  console.log(`${p.state.padEnd(18)} | ${p.account.handle.padEnd(14)} | sched=${sched.padStart(6)} | ${body}`);
}

console.log(`\n유지: ${remaining.length}건`);
await prisma.$disconnect();
