import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { prisma } from '../../src/db/prisma.js';

// 쇼핑 가능 계정: pikkseetem(396, 링크2/5), sookck.kate(427, 링크0/5)
// sookck.kate가 링크 여유 있고 팔로워도 높음
const acc = await prisma.account.findFirst({
  where: { handle: 'sookck.kate' },
  select: { id: true, handle: true },
});

console.log(`계정: ${acc!.handle}`);

const result = await runCustomPublish({
  accountId: acc!.id,
  sourceUrl: 'https://www.threads.com/@yale__unni/post/DfG7FcOAfBz',
  direction: '나이키 운동화 — 쇼핑글. 자연스러운 반응, 광고 티 안 나게.',
  commerceUrl: 'https://link.coupang.com/a/igG7C4sGv6',
  holdApproval: true,
});

console.log('\n결과:', JSON.stringify(result, null, 2));
await prisma.$disconnect();
