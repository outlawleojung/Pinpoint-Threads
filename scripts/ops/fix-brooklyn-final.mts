import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const postId = 'cmw9do07k00018c3jys5hiv31';
const post = await prisma.post.findUnique({
  where: { id: postId },
  include: { account: true, sourceItem: true },
});
if (!post) { console.log('포스트 없음'); process.exit(1); }

const direction = `나이키 플랫폼 하이탑 스니커즈 — 통굽 하이탑, 귀엽고 키 커 보이는 신발
톤: 새로 발견해서 충동구매한 후기
★ 절대 금지:
- 모델명 금지
- 외형 묘사 금지 (색감·소재·디자인)
- "부츠" 단어 금지 (스니커즈/하이탑임)
- 원본 표절 금지
- 착화감·발 편함·발 아픔 언급 금지
- ★★ "작년", "다시 꺼냈다", "서랍에서", "이번 시즌" 등 과거 구매 뉘앙스 절대 금지. 새로 산 것처럼 써라 ★★
★ 허용·필수:
- 브랜드명(나이키) OK
- 키 커 보임, 귀여움, 예쁨 OK
- 광고 아닌 듯 광고, 쓰레드 말투 (반말, ㅋㅋ, ;;)`;

const result = await generateCustomBody({
  direction,
  personaPrompt: post.account.personaPrompt ?? undefined,
  accountSeed: post.account.handle,
  accountId: post.account.id,
  sourceText: undefined, // 원문 영향 차단
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
