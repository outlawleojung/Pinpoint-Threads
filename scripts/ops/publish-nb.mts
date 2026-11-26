import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { prisma } from '../../src/db/prisma.js';

// sookck.kate에 나이키 이미 넣었으니, pikkseetem으로 (링크 2/5, 1건 더 가능)
const acc = await prisma.account.findFirst({
  where: { handle: 'pikkseetem' },
  select: { id: true, handle: true },
});

console.log(`계정: ${acc!.handle}`);

const result = await runCustomPublish({
  accountId: acc!.id,
  sourceUrl: 'https://www.threads.com/@__lilylog/post/DUaew2KklYV',
  direction: '뉴발란스 운동화 — 쇼핑글. 자연스러운 반응, 광고 티 안 나게.',
  commerceUrl: 'https://link.coupang.com/a/igHsca4Ew0',
  holdApproval: true,
});

console.log('\n결과:', JSON.stringify(result, null, 2));
await prisma.$disconnect();
