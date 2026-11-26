import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody, REPLY_LINK_REPEAT } from '../../src/modules/shared/copywriter/index.js';
import { PostKind, PostState } from '@prisma/client';

const MUSINSA_LINK = 'https://www.musinsa.com/curator/goods/H2djhaRA';
const DISCLAIMER = '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const PRODUCT_NAME = '아디다스 퍼프 뮬 카키/퍼플';
const HANDLES = ['pikkseetem', 'sookck.kate'];

const publicUrls = [
  'https://res.cloudinary.com/xwqbwrs1/image/upload/v1794062133/pinpoint-threads/shopping-adidas-puff/stpgqyf21otlyhrgeqni.jpg',
  'https://res.cloudinary.com/xwqbwrs1/image/upload/v1794062135/pinpoint-threads/shopping-adidas-puff/rvxuvtmy7oq9f2esseue.jpg',
  'https://res.cloudinary.com/xwqbwrs1/image/upload/v1794062136/pinpoint-threads/shopping-adidas-puff/jnliz2elwyzimzpggd6k.jpg',
  'https://res.cloudinary.com/xwqbwrs1/image/upload/v1794062137/pinpoint-threads/shopping-adidas-puff/sv0z97091pnjo0v8uq3l.jpg',
  'https://res.cloudinary.com/xwqbwrs1/image/upload/v1794062139/pinpoint-threads/shopping-adidas-puff/vl6kathd5thdpg4fv6it.jpg',
];

for (const handle of HANDLES) {
  const acc = await prisma.account.findFirstOrThrow({
    where: { handle, isActive: true },
    select: { id: true, handle: true, personaPrompt: true },
  });

  const gen = await generateCustomBody({
    direction: `${PRODUCT_NAME} — 겨울 실내화/뮬 추천 톤. 포근하고 가벼운 느낌, 디자인 예쁘다는 반응. 하입/FOMO 쇼핑 카피, 원작자 정황 재연 X, 반응·구매욕 1인칭만. 이 상품은 지금 살 수 있다는 톤.`,
    personaPrompt: acc.personaPrompt ?? undefined,
    accountSeed: acc.id,
    accountId: acc.id,
    sourceImageUrl: publicUrls[0],
    withReplyLead: true,
  });

  const lead = (gen.replyLead ?? '').trim() || '자세한 건 여기서 확인해봐';
  const links = Array(REPLY_LINK_REPEAT).fill(MUSINSA_LINK).join('\n');
  const generatedReply = `[광고] ${lead}\n${links}\n\n${DISCLAIMER}`;

  // Use unique externalId per account to avoid @@unique constraint conflict
  const externalId = `musinsa-H2djhaRA-${handle}`;
  const cp = await prisma.commerceProduct.create({
    data: {
      productName: PRODUCT_NAME,
      productUrl: MUSINSA_LINK,
      deeplinkUrl: MUSINSA_LINK,
      thumbnailUrl: publicUrls[0]!,
      channel: 'MUSINSA',
      externalId,
    },
  });

  const post = await prisma.post.create({
    data: {
      state: PostState.PENDING_APPROVAL,
      kind: PostKind.SHOPPING,
      accountId: acc.id,
      mediaUrl: publicUrls[0],
      mediaUrls: publicUrls,
      sourceMediaUrls: publicUrls,
      generatedBody: gen.body,
      generatedReply,
      commerceProductId: cp.id,
    },
  });

  console.log(`\n=== ${handle} ===`);
  console.log(`  postId: ${post.id}`);
  console.log(`  body: ${gen.body.replace(/\n/g, ' / ').slice(0, 150)}`);
  console.log(`  replyLead: ${gen.replyLead}`);
  console.log(`  media: ${publicUrls.length}장`);
  console.log(`  state: PENDING_APPROVAL (카드 보류)`);
}

await prisma.$disconnect();
console.log('\n✅ 완료. 카드 발송은 사용자 확인 후.');
