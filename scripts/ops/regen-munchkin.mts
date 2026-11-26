import { prisma } from '../../src/db/prisma.js';
import { generateDailyBody } from '../../src/modules/shared/copywriter/index.js';

const postId = 'cmvuvuc3600058cktlq2v92e6';
const post = await prisma.post.findUniqueOrThrow({
  where: { id: postId },
  select: { accountId: true, mediaUrls: true },
});

const imageUrl = post.mediaUrls[1]!; // capture image

let rationale: unknown;
const body = await generateDailyBody({
  accountSeed: `${post.accountId}:regen:${Date.now()}`,
  accountId: post.accountId,
  mediaDescription: '삼색(칼리코) 먼치킨 고양이가 공원 보도 위를 걸어가는 영상. 다리가 매우 짧아서 뒤뚱뒤뚱 걸음. 먼치킨 특유의 짧은 다리가 포인트.',
  frameImageUrls: [imageUrl],
  regenAvoid: '만두, 뚱뚱, 통통, 길고양이, 실화냐',
  onRationale: (r) => { rationale = r; },
});

await prisma.post.update({
  where: { id: postId },
  data: {
    generatedBody: body,
    sourceBrief: { rationale: rationale ?? null } as never,
  },
});

console.log(`카피: ${body}`);
await prisma.$disconnect();
