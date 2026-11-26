import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody, REPLY_LINK_REPEAT } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const BASE_RULE = `
★ 금지:
- 모델명 금지 (퍼피렛, 990v6 등)
- 사진으로 보이는 외형 묘사 금지 (색감, 소재, 디자인 — 사진이 보여준다)
- "사고쳤네", "일냈네" 같은 뻔한 광고 패턴 금지
- 원작자 정황 재연 금지
★ 허용·필수:
- 브랜드명 OK
- 상품 장점·특징은 언급해 (편하다, 가볍다, 핫하다 등 — 사진으로 안 보이는 것)
- 교묘하게 광고 아닌 척 광고. 자연스러운 후기·반응 톤
- 쓰레드 말투: 반말, 줄임말, ㅋㅋ, ;;, ㄷㄷ, ㅠㅠ — 20~30대가 쓰는 실제 쓰레드 말투로`;

const posts = [
  {
    postId: 'cmw6ic4kw00028cejo4w65kfj',
    brand: '아디다스',
    hint: '겨울 실내용 신발. 장점: 엄청 편함, 가벼움, 집에서 이거 한번 신으면 못 벗음',
    tone: '이미 사서 쓰고 있는 사람 후기 톤',
    commerceLink: 'https://www.musinsa.com/curator/goods/H2djhaRA',
    disclaimer: '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
  {
    postId: 'cmw6ic8ms00058cej6g0ryxww',
    brand: '아디다스',
    hint: '겨울 실내용 신발. 장점: 편하고 따뜻함, 디자인도 밖에 나가도 될 정도',
    tone: '발견하고 흥분하는 톤. 위 pikkseetem 카피와 완전히 다른 표현',
    commerceLink: 'https://www.musinsa.com/curator/goods/H2djhaRA',
    disclaimer: '이 포스팅은 무신사 큐레이터 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
  {
    postId: 'cmw6ihegg00028cxuxbauqo0k',
    brand: '뉴발란스',
    hint: '990 시리즈. 장점: 오래 걸어도 안 아픔, 어디에나 어울림, 인기라 금방 품절',
    tone: '득템 자랑 톤',
    commerceLink: 'https://link.coupang.com/a/iujSYqniqO',
    disclaimer: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
  {
    postId: 'cmw6ihtqm00018ca48ixvmk76',
    brand: '뉴발란스',
    hint: '990 시리즈. 장점: 하루종일 신어도 편함, 운동화 중 끝판왕, 리셀가 오르는 중',
    tone: '구매 고민 중인 사람 톤. 위 pikkseetem 카피와 완전히 다른 표현',
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
    direction: `${p.brand} 쇼핑. 상품 힌트: ${p.hint}. 톤: ${p.tone}\n${BASE_RULE}`,
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
  console.log(`✅ ${post.account.handle} ${p.brand}: ${gen.body.replace(/\n/g, ' / ').slice(0, 180)}`);
}

await prisma.$disconnect();
console.log('\n✅ 완료.');
