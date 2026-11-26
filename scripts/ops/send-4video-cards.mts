import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { prisma } from '../../src/db/prisma.js';

const postIds = [
  'cmvuvtck800018ckt1261yamz', // pikkseetem
  'cmvuvtusf00038ckt4q77pt0t', // minyoung.jung
  'cmvuvuc3600058cktlq2v92e6', // hanseoa.pick
  'cmvuvurf400078cktd1k280py', // kle0_lee
];

for (const id of postIds) {
  await sendApprovalRequest(id);
  const post = await prisma.post.findUnique({
    where: { id },
    select: { account: { select: { handle: true } }, generatedBody: true },
  });
  console.log(`✓ ${post!.account.handle}: "${post!.generatedBody}"`);
}

await prisma.$disconnect();
