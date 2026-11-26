import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const url = 'https://www.threads.com/share/_pWIYCnxr';

// minyoung.jung에 배정
const acc = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });
console.log(`🌿 ${acc.handle} ← ${url}`);

const r = await runCustomPublish({
  accountId: acc.id,
  sourceUrl: url,
  holdApproval: true,
  direction: '일상글 — 동물/일상 소재, 반응 한마디, 장면 설명 금지, 감정·리액션만',
});

if (r.status === 'PENDING_APPROVAL') {
  await sendApprovalRequest(r.postId);
  console.log(`✅ ${acc.handle} | 카드 발송 완료 | ${r.body.replace(/\n/g, ' / ').slice(0, 80)}`);
} else {
  console.log(`❌ ${acc.handle} | ${r.stage} | ${r.reason}`);
}

await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
