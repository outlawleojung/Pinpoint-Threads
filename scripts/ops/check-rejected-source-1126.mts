import { prisma } from '../../src/db/prisma.js';
const dayAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

const rejected = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'REJECTED', createdAt: { gte: dayAgo } },
  select: {
    id: true, createdAt: true, updatedAt: true, rejectionReason: true,
    telegramMessageId: true, account: { select: { handle: true } },
  },
  orderBy: { updatedAt: 'desc' },
});

console.log(`총 REJECTED: ${rejected.length}`);

// rejectionReason 분포
const reasons: Record<string, number> = {};
let withTg = 0, withoutTg = 0;
for (const p of rejected) {
  const key = (p.rejectionReason ?? '(없음)').slice(0, 60);
  reasons[key] = (reasons[key] ?? 0) + 1;
  if (p.telegramMessageId) withTg++; else withoutTg++;
}
console.log('\n=== rejection 사유 ===');
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v}건: ${k}`);
}
console.log(`\ntelegramMessageId 있음(사용자/카드): ${withTg}`);
console.log(`telegramMessageId 없음(스크립트·시스템): ${withoutTg}`);

// 최근 5건 상세
console.log('\n=== 최근 5건 ===');
for (const p of rejected.slice(0, 5)) {
  console.log(`\n@${p.account.handle} ${p.updatedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  id: ${p.id}`);
  console.log(`  telegramMessageId: ${p.telegramMessageId ?? '(없음)'}`);
  console.log(`  rejection: ${(p.rejectionReason ?? '').slice(0, 150)}`);
}

await prisma.$disconnect();
