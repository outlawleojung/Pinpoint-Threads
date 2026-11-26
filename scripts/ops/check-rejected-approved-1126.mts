import { prisma } from '../../src/db/prisma.js';
const dayAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

// 사용자가 승인했는데 REJECTED 로 넘어간 건 — approvedAt이 있는 REJECTED
const approvedButRejected = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    state: 'REJECTED',
    createdAt: { gte: dayAgo },
    approvedAt: { not: null },
  },
  select: {
    id: true, approvedAt: true, updatedAt: true, rejectionReason: true,
    telegramMessageId: true, account: { select: { handle: true } },
  },
  orderBy: { updatedAt: 'desc' },
});

console.log(`승인됐었는데 REJECTED: ${approvedButRejected.length}건`);
for (const p of approvedButRejected.slice(0, 15)) {
  const approvedKr = p.approvedAt?.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const rejKr = p.updatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`\n@${p.account.handle}`);
  console.log(`  승인: ${approvedKr} → REJECTED: ${rejKr}`);
  console.log(`  사유: ${(p.rejectionReason ?? '(없음)').slice(0, 100)}`);
}

// 승인 안 하고 REJECTED (approvedAt null)
const nonApprovedRejected = await prisma.post.count({
  where: { kind: 'SHOPPING', state: 'REJECTED', createdAt: { gte: dayAgo }, approvedAt: null },
});
console.log(`\n승인없이 REJECTED: ${nonApprovedRejected}건`);

// PUBLISHED 와 APPROVED 는 approvedAt 가지고 있을 것
const published = await prisma.post.count({
  where: { kind: 'SHOPPING', createdAt: { gte: dayAgo }, approvedAt: { not: null }, state: { in: ['PUBLISHED', 'APPROVED', 'PUBLISHING'] } },
});
console.log(`승인 후 정상 흐름(PUBLISHED/APPROVED/PUBLISHING): ${published}건`);

await prisma.$disconnect();
