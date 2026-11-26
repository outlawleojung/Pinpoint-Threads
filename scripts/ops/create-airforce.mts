import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const sourceUrl = 'https://www.threads.com/@yuji.ni1122/post/DfeI_tLEZZD';
const commerceUrl = 'https://link.coupang.com/a/ivYUCBcVR6';

const COPY_RULE = `나이키 에어포스 쇼핑 소재.
★ 금지: 모델명 금지, 외형 묘사 금지 (색감·소재·디자인), 뻔한 광고 패턴 금지, 원작자 정황 재연 금지
★ 허용·필수: 브랜드명(나이키) OK, 장점·특징 OK (편하다, 클래식하다), 광고 아닌 척 광고, 쓰레드 말투`;

const handles = ['pikkseetem', 'sookck.kate'];

for (const handle of handles) {
  const acc = await prisma.account.findFirstOrThrow({ where: { handle } });
  try {
    const r = await runCustomPublish({
      accountId: acc.id,
      sourceUrl,
      commerceUrl,
      holdApproval: true,
      direction: COPY_RULE,
    });
    if (r.status === 'PENDING_APPROVAL') {
      console.log(`✅ ${handle}: ${r.body.replace(/\n/g, ' / ').slice(0, 120)}`);
      await sendApprovalRequest(r.postId);
      console.log(`📨 카드 발송: ${r.postId.slice(-8)}`);
    } else {
      console.log(`❌ ${handle}: ${r.stage} — ${r.reason}`);
    }
  } catch (err) {
    console.log(`❌ ${handle}: ${(err as Error).message.slice(0, 150)}`);
  }
}

console.log('\n✅ 완료.');
await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
