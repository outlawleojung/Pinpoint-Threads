import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const postId = 'cmw7y2uxy00078ccoyfwphyvb';

const post = await prisma.post.findUnique({
  where: { id: postId },
  include: { account: true, sourceItem: true },
});

if (!post) { console.log('포스트 없음'); process.exit(1); }

const direction = `나이키 브루클린 부츠 — 겨울 부츠, 편하고 따뜻함
톤: 겨울 준비하면서 발견한 느낌 — 이거 괜찮은데?
★ 금지:
- 모델명 금지
- 사진으로 보이는 외형 묘사 금지 (색감·소재·디자인)
- "사고쳤네", "일냈네" 같은 뻔한 광고 패턴 금지
- 원작자 정황 재연 금지
- ★★ 원본 표현·문장구조·키워드 재사용 절대 금지 ★★
- ★★ "에어포스" 절대 언급 금지. 이 상품은 나이키 부츠임 ★★
★ 허용·필수:
- 브랜드명(나이키) OK
- 상품 장점·특징 OK (편하다, 따뜻하다)
- 교묘하게 광고 아닌 듯 광고. 자연스러운 후기 톤
- 쓰레드 말투 (반말, ㅋㅋ, ;;)
- 완전히 새로운 각도와 표현으로 써라`;

const result = await generateCustomBody({
  direction,
  personaPrompt: post.account.personaPrompt ?? undefined,
  accountSeed: post.account.handle,
  accountId: post.account.id,
  sourceText: post.sourceItem?.rawText ?? undefined,
  sourceImageUrl: (post.mediaUrls?.[0]) ?? undefined,
  withReplyLead: Boolean(post.generatedReply),
});

// reply에서 replyLead만 교체, 링크 유지
let newReply = post.generatedReply;
if (result.replyLead && post.generatedReply) {
  const lines = post.generatedReply.split('\n');
  lines[0] = result.replyLead;
  newReply = lines.join('\n');
}

await prisma.post.update({
  where: { id: postId },
  data: {
    generatedBody: result.body,
    generatedReply: newReply,
    cardVersion: { increment: 1 },
  },
});

console.log(`✅ 새 카피:\n${result.body}`);
console.log(`\n✅ 고정댓글:\n${newReply}`);

await sendApprovalRequest(postId);
console.log(`\n📨 카드 재발송 완료`);

await prisma.$disconnect();
