// 2h+ CLASSIFYING/MATCHING/COPYWRITING/PUBLISHING stuck 전부 FAILED 처리
import { prisma } from '../../src/db/prisma.js';

const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
const zombies = await prisma.post.findMany({
  where: {
    state: { in: ['CLASSIFYING', 'MATCHING', 'COPYWRITING', 'PUBLISHING'] },
    updatedAt: { lt: twoHoursAgo },
  },
  select: { id: true, kind: true, state: true, createdAt: true, account: { select: { handle: true } } },
});

console.log(`좀비: ${zombies.length}건\n`);
for (const z of zombies) {
  await prisma.post.update({
    where: { id: z.id },
    data: { state: 'FAILED', rejectionReason: `zombie ${z.state} ${((Date.now() - z.createdAt.getTime())/3600_000).toFixed(0)}h stuck` },
  });
  console.log(`  FAILED @${z.account.handle} ${z.kind} [${z.state}] ${z.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
}

await prisma.$disconnect();
