import { prisma } from '../../src/db/prisma.js';

const fixes = [
  { id: 'cmvuvtck800018ckt1261yamz', body: '아 미쳤다 진짜ㅋㅋㅋㅋ' },
  { id: 'cmvuvtusf00038ckt4q77pt0t', body: '심장 녹는다ㅋㅋㅋ' },
  { id: 'cmvuvuc3600058cktlq2v92e6', body: '계속 보게 되네ㅋㅋ' },
  { id: 'cmvuvurf400078cktd1k280py', body: '데려가고 싶다 진심' },
];

for (const f of fixes) {
  const post = await prisma.post.update({
    where: { id: f.id },
    data: { generatedBody: f.body },
    select: { id: true, account: { select: { handle: true } } },
  });
  console.log(`${post.account.handle}: "${f.body}"`);
}

await prisma.$disconnect();
