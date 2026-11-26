import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const post = await prisma.post.findUnique({
  where: { id: 'cmw9do07k00018c3jys5hiv31' },
  include: { account: { select: { handle: true } } },
});

if (post) {
  console.log(`상태: ${post.state}`);
  console.log(`카드버전: ${post.cardVersion}`);
  console.log(`\n현재 본문:\n${post.generatedBody}`);
  console.log(`\n현재 고정댓글:\n${post.generatedReply}`);
  
  // 최신 카드 재발송
  console.log('\n📨 최신 카드 재발송...');
  await sendApprovalRequest(post.id);
  console.log('✅ 완료');
}

await prisma.$disconnect();
