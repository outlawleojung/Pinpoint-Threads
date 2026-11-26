import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody } from '../../src/modules/shared/copywriter/index.js';

const postId = 'cmvus0jlb00018ce2md2m6pc1';
const post = await prisma.post.findUniqueOrThrow({
  where: { id: postId },
  select: { accountId: true, account: { select: { handle: true, personaPrompt: true } } },
});

const gen = await generateCustomBody({
  direction: '고양이 새끼가 뒤뚱뒤뚱 걷는 영상. 짧은 반응 한마디만. 감성멘트·힐링멘트·사족 금지. 한두 줄이면 충분.',
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
