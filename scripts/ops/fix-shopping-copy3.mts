import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody, REPLY_LINK_REPEAT } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const DIRECTION_RULE = `
★★★ 절대 금지 (위반 시 즉시 폐기):
- 모델명 금지 (퍼피렛, 990v6, 에어맥스 등 모델 이름 절대 쓰지 마)
- 상품 외형·색감·소재·기능·착용감을 글로 묘사하지 마. 사진이 이미 보여주고 있다
- "카키", "퍼플", "그레이", "패딩", "포근", "쿠셔닝" 같은 상품 설명 단어 전부 금지
★★★ 허용:
- 브랜드명은 OK (아디다스, 뉴발란스)
★★★ 써야 하는 것:
- 순수한 감정 반응과 구매 충동만. 사진 보고 터지는 반응, 지름 충동, 품절 공포
- 원작자 정황 재연 X, 1인칭 반응·구매욕만`;

const posts = [
  { postId: 'cmw6ic4kw00028cejo4w65kfj', brand: '아디다스', commerceLink: 'https://www.musinsa.com/curator/goods/H2djhaRA', disclaimer: '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
  { postId: 'cmw6ic8ms00058cej6g0ryxww', brand: '아디다스', commerceLink: 'https://www.musinsa.com/curator/goods/H2djhaRA', disclaimer: '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
  { postId: 'cmw6ihegg00028cxuxbauqo0k', brand: '뉴발란스', commerceLink: 'https://link.coupang.com/a/iujSYqniqO', disclaimer: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
  { postId: 'cmw6ihtqm00018ca48ixvmk76', brand: '뉴발란스', commerceLink: 'https://link.coupang.com/a/iujSYqniqO', disclaimer: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.' },
];

for (const p of posts) {
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: p.postId },
    select: { accountId: true, account: { select: { handle: true, personaPrompt: true } } },
  });

  const gen = await generateCustomBody({
    direction: `${p.brand} 쇼핑 카피. ${DIRECTION_RULE}`,
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
