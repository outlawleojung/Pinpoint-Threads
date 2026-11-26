import { prisma } from '../../src/db/prisma.js';
import { generateCopy } from '../../src/modules/shared/copywriter/index.js';

const postId = 'cmvuse8hi00028clfwj1626gi';
const post = await prisma.post.findUniqueOrThrow({
  where: { id: postId },
  include: { account: true },
});

console.log('기존 카피:', post.generatedBody);
console.log('\n--- 재생성 중 ---\n');

// 이미지 기반 재생성 — 원문 텍스트 없이 이미지 + 상품명으로
const copy = await generateCopy({
  sourceText: '',
  sourceImageUrl: post.mediaUrls[0],
  productName: '뉴발란스 스니커즈',
  productCategory: '신발',
  accountSeed: `${post.accountId}:regen:1`,
  accountId: post.accountId,
  personaPrompt: post.account.personaPrompt,
  deeplinkUrl: 'https://link.coupang.com/a/igHsca4Ew0',
  channel: 'COUPANG',
  ragEnabled: false,
  factCheckEnabled: true,
  regenAvoid: `원문 카피를 번역하거나 의역하지 마라. "감다살", "발렌시아가 느낌", "스타일 다 먹힘", "이쁘긴 또 왜케 이쁨" 등 이전 문구 절대 금지. 완전히 새로운 시각에서 써라.`,
});

await prisma.post.update({
  where: { id: postId },
  data: {
    generatedBody: copy.body,
    generatedReply: copy.replyBody ?? post.generatedReply,
    retryCount: { increment: 1 },
  },
});

console.log('새 카피:', copy.body);

await prisma.$disconnect();
