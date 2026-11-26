import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

// 1. 잘못된 브루클린 포스트 폐기
await prisma.post.update({
  where: { id: 'cmw7y2uxy00078ccoyfwphyvb' },
  data: { state: 'REJECTED' },
});
console.log('❌ 잘못된 브루클린 포스트 폐기 완료');

// 2. DfdbCCcDbF3에서 새로 생성 (1상품=1계정 → sookck.kate)
const account = await prisma.account.findFirst({
  where: { handle: 'sookck.kate' },
});

if (!account) {
  console.log('⚠️ sookck.kate 계정 못 찾음');
  process.exit(1);
}

console.log('\n📦 DfdbCCcDbF3 기반 브루클린 포스트 생성 중...');
const result = await runCustomPublish({
  sourceUrl: 'https://www.threads.com/@mika_mama.a/post/DfdbCCcDbF3',
  commerceUrl: 'https://www.musinsa.com/curator/goods/Cvi8Ru27',
  accountId: account.id,
  direction: '나이키 브루클린 우먼스 부츠 — 겨울 부츠, 편하고 따뜻함\n톤: 겨울 준비하면서 발견한 느낌\n★ 금지: 모델명 금지, 외형묘사 금지, 원본 표절 금지\n★ 필수: 브랜드명 OK, 장점 OK, 쓰레드 말투',
  holdApproval: true,
});

if (result.status === 'PENDING_APPROVAL') {
  console.log(`\n✅ 포스트 생성: ${result.postId}`);
  console.log(`카피: ${result.body.slice(0, 100)}`);

  // 카드 발송
  await sendApprovalRequest(result.postId);
  console.log('📨 승인 카드 발송');
} else {
  console.log(`\n❌ 실패: ${result.stage} — ${result.reason}`);
}

await prisma.$disconnect();
