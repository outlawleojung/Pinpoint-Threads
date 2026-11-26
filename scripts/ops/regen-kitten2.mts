import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody } from '../../src/modules/shared/copywriter/index.js';

const postId = 'cmvus0jlb00018ce2md2m6pc1';
const post = await prisma.post.findUniqueOrThrow({
  where: { id: postId },
  select: { accountId: true, account: { select: { handle: true, personaPrompt: true } } },
});

const gen = await generateCustomBody({
  direction: '태어난 지 얼마 안 된 아기 고양이 영상. 진짜 작고 앙증맞은 새끼 고양이. 짧은 반응 한마디. 감성멘트·힐링멘트·교훈 금지. 웃기다는 반응도 아님 — 작고 귀여운 거에 대한 자연스러운 반응. 한두 줄.',
  personaPrompt: post.account.personaPrompt,
  accountSeed: post.accountId,
  accountId: post.accountId,
  withReplyLead: false,
});

console.log('카피:', gen.body);

await prisma.post.update({
  where: { id: postId },
  data: { generatedBody: gen.body },
});

console.log('업데이트 완료');
await prisma.$disconnect();
