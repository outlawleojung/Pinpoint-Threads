import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

// === 0. 커머스 링크 저장 (아디다스 가죽 후드) ===
const adidasInbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'BAavf0uiXt' } },
});
if (adidasInbound) {
  await prisma.inboundLink.update({
    where: { id: adidasInbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivYtWG6LVA' },
  });
  console.log(`✅ 아디다스 가죽 후드 커머스 링크 저장`);
}

// === 1. DcAnJAAbH 인바운드 상태를 FETCHED로 업데이트해서 runCustomPublish가 돌게 ===
const dcLink = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'DcAnJAAbH' } },
});
if (dcLink && dcLink.status === 'RECEIVED') {
  await prisma.inboundLink.update({
    where: { id: dcLink.id },
    data: { status: 'FETCHED' },
  });
  console.log(`✅ DcAnJAAbH 상태 RECEIVED → FETCHED`);
}

// === 2. 소재 정의 ===
const items: { url: string; commerceUrl: string; label: string }[] = [
  {
    url: 'https://www.threads.com/share/DcAnJAAbH',
    commerceUrl: 'https://link.coupang.com/a/ivYf5EgT7Y',
    label: '소재1',
  },
  {
    url: 'https://www.threads.com/share/BAavf0uiXt',
    commerceUrl: 'https://link.coupang.com/a/ivYtWG6LVA',
    label: '아디다스 가죽',
  },
];

const COPY_RULE = `
★ 금지:
- 모델명 금지 (모델 이름 절대 X)
- 사진으로 보이는 외형 묘사 금지 (색감, 소재, 디자인)
- "사고쳤네", "일냈네" 같은 뻔한 광고 패턴 금지
- 원작자 정황 재연 금지
★ 허용·필수:
- 브랜드명 OK
- 상품 장점·특징 언급 OK (편하다, 가볍다 — 사진으로 안 보이는 것)
- 교묘하게 광고 아닌 듯 광고. 자연스러운 후기 톤
- 쓰레드 말투 (반말, ㅋㅋ, ;;)
`.trim();

const handles = ['pikkseetem', 'sookck.kate'];
const created: { postId: string; handle: string; label: string }[] = [];

// === 3. 이미 만든 헌터 부츠 2건 카드부터 발송 ===
const hunterPosts = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    state: 'PENDING_APPROVAL',
    sourceItem: { sourceUrl: { contains: 'BACjZFUSKp' } },
  },
  select: { id: true, account: { select: { handle: true } } },
});
for (const hp of hunterPosts) {
  await sendApprovalRequest(hp.id);
  console.log(`📨 헌터 카드: ${hp.account.handle} (${hp.id.slice(-8)})`);
}

// === 4. 나머지 소재 생성 ===
for (const item of items) {
  for (const handle of handles) {
    const acc = await prisma.account.findFirstOrThrow({ where: { handle } });
    try {
      const r = await runCustomPublish({
        accountId: acc.id,
        sourceUrl: item.url,
        commerceUrl: item.commerceUrl,
        holdApproval: true,
        direction: `${item.label} — ${COPY_RULE}`,
      });
      if (r.status === 'PENDING_APPROVAL') {
        created.push({ postId: r.postId, handle, label: item.label });
        console.log(`✅ ${handle} ${item.label}: ${r.body.replace(/\n/g, ' / ').slice(0, 120)}`);
      } else {
        console.log(`❌ ${handle} ${item.label}: ${r.stage} — ${r.reason}`);
      }
    } catch (err) {
      console.log(`❌ ${handle} ${item.label}: ${(err as Error).message.slice(0, 150)}`);
    }
  }
}

// === 5. 카드 발송 ===
console.log(`\n=== 카드 발송 (${created.length}건) ===`);
for (const { postId, handle, label } of created) {
  await sendApprovalRequest(postId);
  console.log(`📨 ${handle} ${label} (${postId.slice(-8)})`);
}

console.log('\n✅ 완료.');
await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
