// 오늘 생성된 쇼핑 포스트를 4개 계정에 골고루 분배
import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const HANDLES = ['pikkseetem', 'minyoung.jung', 'hanseoa.pick', 'kle0_lee'];

const today = new Date();
today.setHours(0, 0, 0, 0);

const posts = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    state: { in: ['PENDING_APPROVAL', 'DRAFT'] },
    createdAt: { gte: today },
  },
  include: { account: { select: { handle: true } } },
  orderBy: { createdAt: 'asc' },
});

console.log(`오늘 쇼핑 포스트: ${posts.length}건\n`);

const accounts = await Promise.all(
  HANDLES.map(h => prisma.account.findFirstOrThrow({ where: { handle: h } })),
);
const accountMap = Object.fromEntries(accounts.map(a => [a.handle, a.id]));

let idx = 0;
for (const post of posts) {
  const targetHandle = HANDLES[idx % HANDLES.length]!;
  const targetId = accountMap[targetHandle]!;
  idx++;

  if (post.accountId !== targetId) {
    await prisma.post.update({ where: { id: post.id }, data: { accountId: targetId } });
    console.log(`🔄 ${post.account.handle} → ${targetHandle} | ${(post.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 60)}`);
  } else {
    console.log(`✅ ${targetHandle} (유지) | ${(post.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 60)}`);
  }
}

// 계정별 집계
const summary: Record<string, number> = {};
for (let i = 0; i < posts.length; i++) {
  const h = HANDLES[i % HANDLES.length]!;
  summary[h] = (summary[h] ?? 0) + 1;
}
console.log('\n계정별 배분:', summary);

await prisma.$disconnect();
