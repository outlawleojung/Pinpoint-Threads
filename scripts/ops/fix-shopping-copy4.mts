import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody, REPLY_LINK_REPEAT } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const BASE_RULE = `
★ 절대 금지:
- 모델명 금지 (퍼피렛, 990v6 등)
- 상품 외형·색감·소재·기능·착용감 묘사 금지. 사진이 보여준다
- 브랜드명은 OK
★ 써야 하는 것: 순수 반응·구매욕만. 원작자 정황 재연 X`;

const posts = [
  {
    postId: 'cmw6ic4kw00028cejo4w65kfj',
    brand: '아디다스',
    tone: '충동구매 후회 없음 톤. "질렀다/후회 없다" 느낌. "사고쳤네/일냈네" 같은 표현 쓰지 마.',
    commerceLink: 'https://www.musinsa.com/curator/goods/H2djhaRA',
    disclaimer: '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
  {
    postId: 'cmw6ic8ms00058cej6g0ryxww',
    brand: '아디다스',
    tone: '품절 공포 톤. "놓치면 못 산다" 느낌. "사고쳤네/일냈네/질렀다" 같은 표현 쓰지 마.',
    commerceLink: 'https://www.musinsa.com/curator/goods/H2djhaRA',
    disclaimer: '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
  {
    postId: 'cmw6ihegg00028cxuxbauqo0k',
    brand: '뉴발란스',
    tone: '자랑·과시 톤. "이거 내 발에 있다" 느낌. "사고쳤네/일냈네/질렀다/품절" 같은 표현 쓰지 마.',
    commerceLink: 'https://link.coupang.com/a/iujSYqniqO',
    disclaimer: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
  {
    postId: 'cmw6ihtqm00018ca48ixvmk76',
    brand: '뉴발란스',
    tone: '발견·득템 톤. "이걸 찾았다/이게 아직 있었네" 느낌. "사고쳤네/일냈네/질렀다/품절/내 발" 같은 표현 쓰지 마.',
    commerceLink: 'https://link.coupang.com/a/iujSYqniqO',
    disclaimer: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
];

for (const p of posts) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: p.postId },
    select: { accountId: true, account: { select: { handle: true, personaPrompt: true } } },
  });

  const gen = await generateCustomBody({
    direction: `${p.brand} 쇼핑. ${p.tone}\n${BASE_RULE}`,
    personaPrompt: post.account.personaPrompt ?? undefined,
    accountSeed: post.accountId,
    accountId: post.accountId,
    withReplyLead: true,
  });

  const lead = (gen.replyLead ?? '').trim() || '자세한 건 여기서 확인해봐';
  const links = Array(REPLY_LINK_REPEAT).fill(p.commerceLink).join('\n');
  const generatedReply = `[광고] ${lead}\n${links}\n\n${p.disclaimer}`;

  await prisma.post.update({
    where: { id: p.postId },
    data: { generatedBody: gen.body, generatedReply, cardVersion: { increment: 1 } },
  });

  await sendApprovalRequest(p.postId);
  console.log(`✅ ${post.account.handle} ${p.brand}: ${gen.body.replace(/\n/g, ' / ').slice(0, 150)}`);
}

await prisma.$disconnect();
console.log('\n✅ 완료.');
