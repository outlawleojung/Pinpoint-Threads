import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody, REPLY_LINK_REPEAT } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

// === 1. 아디다스 퍼피렛 (pikkseetem + sookck.kate) ===
const adidasPosts = [
  { postId: 'cmw6ic4kw00028cejo4w65kfj', handle: 'pikkseetem' },
  { postId: 'cmw6ic8ms00058cej6g0ryxww', handle: 'sookck.kate' },
];

for (const { postId, handle } of adidasPosts) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    select: { accountId: true, mediaUrls: true, account: { select: { personaPrompt: true } } },
  });

  const gen = await generateCustomBody({
    direction: '아디다스 퍼피렛 실버그린 — 겨울 패딩 슬리퍼 추천 톤. 포근하고 가벼운 느낌, 색감 예쁘다는 반응. 하입/FOMO 쇼핑 카피, 원작자 정황 재연 X, 반응·구매욕 1인칭만. 이 상품은 지금 살 수 있다는 톤.',
    personaPrompt: post.account.personaPrompt ?? undefined,
    accountSeed: post.accountId,
    accountId: post.accountId,
    sourceImageUrl: post.mediaUrls[0] ?? undefined,
    withReplyLead: true,
  });

  const lead = (gen.replyLead ?? '').trim() || '자세한 건 여기서 확인해봐';
  const MUSINSA_LINK = 'https://www.musinsa.com/curator/goods/H2djhaRA';
  const links = Array(REPLY_LINK_REPEAT).fill(MUSINSA_LINK).join('\n');
  const generatedReply = `[광고] ${lead}\n${links}\n\n이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.`;

  await prisma.post.update({
    where: { id: postId },
    data: { generatedBody: gen.body, generatedReply, cardVersion: { increment: 1 } },
  });
  await prisma.commerceProduct.updateMany({
    where: { posts: { some: { id: postId } } },
    data: { productName: '아디다스 퍼피렛 실버그린' },
  });

  await sendApprovalRequest(postId);
  console.log(`✅ 아디다스 퍼피렛 ${handle}: ${gen.body.replace(/\n/g, ' / ').slice(0, 120)}`);
}

// === 2. 뉴발란스 990v6 (pikkseetem + sookck.kate) ===
const nbPosts = [
  { postId: 'cmw6ihegg00028cxuxbauqo0k', handle: 'pikkseetem' },
  { postId: 'cmw6ihtqm00018ca48ixvmk76', handle: 'sookck.kate' },
];

for (const { postId, handle } of nbPosts) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    select: { accountId: true, mediaUrls: true, generatedReply: true, account: { select: { personaPrompt: true } } },
  });

  const gen = await generateCustomBody({
    direction: '뉴발란스 990v6 — 발매 후 재입고/사이즈 남아있는 상황. 하입/FOMO 쇼핑 카피, 원작자 정황 재연 X, 반응·구매욕 1인칭만.',
    personaPrompt: post.account.personaPrompt ?? undefined,
    accountSeed: post.accountId,
    accountId: post.accountId,
    sourceImageUrl: post.mediaUrls[0] ?? undefined,
    withReplyLead: true,
  });

  const lead = (gen.replyLead ?? '').trim() || '자세한 건 여기서 확인해봐';
  const COUPANG_LINK = 'https://link.coupang.com/a/iujSYqniqO';
  const links = Array(REPLY_LINK_REPEAT).fill(COUPANG_LINK).join('\n');
  const generatedReply = `[광고] ${lead}\n${links}\n\n이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.`;

  await prisma.post.update({
    where: { id: postId },
    data: { generatedBody: gen.body, generatedReply, cardVersion: { increment: 1 } },
  });

  await sendApprovalRequest(postId);
  console.log(`✅ 뉴발란스 990v6 ${handle}: ${gen.body.replace(/\n/g, ' / ').slice(0, 120)}`);
}

await prisma.$disconnect();
console.log('\n✅ 4건 모두 카피 수정 + 카드 재발송 완료.');
