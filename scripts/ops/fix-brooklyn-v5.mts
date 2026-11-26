import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const postId = 'cmw9do07k00018c3jys5hiv31';
const post = await prisma.post.findUnique({
  where: { id: postId },
  include: { account: true },
});
if (!post) { console.log('포스트 없음'); process.exit(1); }

const direction = `나이키 통굽 하이탑 스니커즈.
이거 진짜 귀엽고 키도 커 보여서 좋다는 자연스러운 후기.
쓰레드에서 친구한테 말하듯이 편하게 써. 과장하지 말고.`;

const result = await generateCustomBody({
  direction,
  personaPrompt: post.account.personaPrompt ?? undefined,
  accountSeed: post.account.handle,
  accountId: post.account.id,
  sourceText: undefined,
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
  data: { generatedBody: result.body, generatedReply: newReply, cardVersion: { increment: 1 } },
});

console.log(`✅ 새 카피:\n${result.body}`);
console.log(`\n✅ 고정댓글:\n${newReply}`);
await sendApprovalRequest(postId);
console.log(`\n📨 카드 재발송`);
await prisma.$disconnect();
