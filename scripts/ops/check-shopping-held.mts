import { prisma } from '../../src/db/prisma.js';

// 보관 중 쇼핑 포스트 (HOLD, DRAFT, PENDING_APPROVAL 등)
const held = await prisma.post.findMany({
  where: { kind: 'SHOPPING' },
  select: {
    id: true, state: true, createdAt: true,
    account: { select: { handle: true } },
    generatedBody: true,
    commerceProduct: { select: { productName: true, productUrl: true } },
  },
  orderBy: { createdAt: 'desc' },
  take: 20,
});

console.log(`=== 전체 쇼핑 포스트 (최근 20건) ===`);
for (const p of held) {
  const name = p.commerceProduct?.productName ?? p.generatedBody?.slice(0, 40) ?? '?';
  console.log(`  ${p.id.slice(-8)} | ${p.state.padEnd(18)} | ${p.account.handle.padEnd(14)} | ${p.createdAt.toISOString().slice(0, 10)} | ${name}`);
}

// 런북에 기록된 보관 ID 확인
const ids = ['cmvitju3w0005qvz4173du998', 'cmvitk4wf0008qvz4pdmd148j', 'cmvitkhqs000bqvz4u1762tnv'];
console.log(`\n=== 런북 보관 소재 상태 ===`);
for (const id of ids) {
  const p = await prisma.post.findUnique({
    where: { id },
    select: { id: true, state: true, account: { select: { handle: true } }, commerceProduct: { select: { productName: true } } },
  });
  if (p) {
    console.log(`  ${id.slice(-8)} | ${p.state} | ${p.account.handle} | ${p.commerceProduct?.productName ?? '?'}`);
  } else {
    console.log(`  ${id.slice(-8)} | NOT FOUND`);
  }
}

await prisma.$disconnect();
