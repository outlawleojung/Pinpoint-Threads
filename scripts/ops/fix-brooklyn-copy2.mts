import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const postId = 'cmw9do07k00018c3jys5hiv31';

const post = await prisma.post.findUnique({
  where: { id: postId },
  include: { account: true, sourceItem: true },
});

if (!post) { console.log('포스트 없음'); process.exit(1); }

const direction = `나이키 플랫폼 하이탑 스니커즈 — 통굽 플랫폼에 하이탑, 귀엽고 키도 커 보임
톤: 계절 바뀌면서 다시 꺼냈는데 역시 좋은 느낌
★ 금지:
- 모델명 금지 (브루클린 등 모델명 절대 X)
- 사진으로 보이는 외형 묘사 금지 (색감·소재·디자인)
- "사고쳤네", "일냈네" 같은 뻔한 광고 패턴 금지
- ★★ "부츠" 단어 절대 금지. 이건 스니커즈/하이탑임 ★★
- ★★ 원본 표현·문장구조 재사용 절대 금지 ★★
★ 허용·필수:
- 브랜드명(나이키) OK
- 장점 OK (키 커 보임, 편함, 귀여움)
- 교묘하게 광고 아닌 듯 광고. 자연스러운 후기 톤
- 쓰레드 말투 (반말, ㅋㅋ, ;;)`;

const result = await generateCustomBody({
  direction,
  personaPrompt: post.account.personaPrompt ?? undefined,
  accountSeed: post.account.handle,
  accountId: post.account.id,
  sourceText: post.sourceItem?.rawText ?? undefined,
  sourceImageUrl: (post.mediaUrls?.[0]) ?? undefined,
  withReplyLead: Boolean(post.generatedReply),
});

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
