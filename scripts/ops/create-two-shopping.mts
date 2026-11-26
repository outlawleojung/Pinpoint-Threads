import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

// === 1. 헌터 부츠 — 커머스 링크 저장 ===
const hunterInbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'BACjZFUSKp' } },
});
if (hunterInbound) {
  await prisma.inboundLink.update({
    where: { id: hunterInbound.id },
    data: { manualCommerceUrl: 'https://link.coupang.com/a/ivYp8mWeZw' },
  });
  console.log(`✅ 헌터 부츠 인바운드에 커머스 링크 저장: ${hunterInbound.id}`);
} else {
  console.log('⚠️ 헌터 부츠 인바운드 링크를 못 찾음');
}

// === 2. 두 소재 정의 ===
const items: { url: string; commerceUrl: string; desc: string }[] = [
  {
    url: 'https://www.threads.com/share/DcAnJAAbH',
    commerceUrl: 'https://link.coupang.com/a/ivYf5EgT7Y',
    desc: '쇼핑 소재',
  },
  {
    url: 'https://www.threads.com/share/BACjZFUSKp',
    commerceUrl: 'https://link.coupang.com/a/ivYp8mWeZw',
    desc: '헌터 부츠',
  },
];

// 카피 공통 룰
const COPY_RULE = `
★ 금지:
- 모델명 금지 (모델 이름 절대 X — 검색으로 찾게)
- 사진으로 보이는 외형 묘사 금지 (색감, 소재, 디자인 — 사진이 보여준다)
- "사고쳤네", "일냈네" 같은 뻔한 광고 패턴 금지
- 원작자 정황 재연 금지
★ 허용·필수:
- 브랜드명 OK
- 상품 장점·특징 언급 OK (편하다, 가볍다, 핫하다 — 사진으로 안 보이는 것)
- 교묘하게 광고 아닌 듯 광고. 자연스러운 후기·반응 톤
- 쓰레드 말투 (반말, ㅋㅋ, ;;)
`.trim();

// === 3. 두 계정에 각각 생성 (pikkseetem, sookck.kate) ===
const handles = ['pikkseetem', 'sookck.kate'];
const createdPosts: { postId: string; handle: string; desc: string }[] = [];

for (const item of items) {
  for (const handle of handles) {
    const acc = await prisma.account.findFirstOrThrow({ where: { handle } });
    const direction = `${item.desc} — ${COPY_RULE}`;
    const r = await runCustomPublish({
      accountId: acc.id,
      sourceUrl: item.url,
      commerceUrl: item.commerceUrl,
      holdApproval: true,
      direction,
    });
    if (r.status === 'PENDING_APPROVAL') {
      createdPosts.push({ postId: r.postId, handle, desc: item.desc });
      console.log(`✅ ${handle} ${item.desc}: ${r.body.replace(/\n/g, ' / ').slice(0, 120)}`);
    } else {
      console.log(`❌ ${handle} ${item.desc}: ${r.stage} — ${r.reason}`);
    }
  }
}

// === 4. 승인 카드 발송 ===
console.log(`\n=== 승인 카드 발송 (${createdPosts.length}건) ===`);
for (const { postId, handle, desc } of createdPosts) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { account: true, sourceItem: true, commerceProduct: true },
  });
  await sendApprovalRequest(post as any);
  console.log(`📨 카드 발송: ${handle} ${desc} (${postId.slice(-8)})`);
}

console.log('\n✅ 완료.');
await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
