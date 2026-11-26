import { prisma } from '../../src/db/prisma.js';
import { judge } from '../../src/modules/pipeline-c/source-watch.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const postId = 'cmw6ju8k600038c9wc5e8qv18';
const post = await prisma.post.findUnique({
  where: { id: postId },
  select: { mediaUrls: true, sourceBrief: true },
});

if (!post) { console.log('없음'); process.exit(1); }

const videoUrl = post.mediaUrls.find((u) => u.includes('/video/upload/'));
if (!videoUrl) { console.log('영상 없음'); process.exit(1); }

// 캡션 없이 영상으로 judge 호출 (소스 캡션이 없으므로 빈 문자열)
console.log('judge 호출 중...');
const result = await judge('', videoUrl);

console.log('skip:', result.skip);
console.log('situation:', result.situation);
console.log('candidates:', result.candidates);

if (result.skip || result.candidates.length === 0) {
  console.log('⚠️ judge가 skip — 수동 후보 생성 필요');
  process.exit(1);
}

// DB 업데이트: generatedBody + sourceBrief.altBodies
await prisma.post.update({
  where: { id: postId },
  data: {
    generatedBody: result.candidates[0],
    sourceBrief: {
      ...((post.sourceBrief as object | null) ?? {}),
      rationale: { situation: result.situation ?? null },
      altBodies: result.candidates,
    } as never,
    cardVersion: { increment: 1 },
  },
});

console.log(`\n✅ 후보 ${result.candidates.length}개 저장`);
result.candidates.forEach((c, i) => console.log(`  ${'①②③'[i]} ${c}`));

// 카드 재발송
await sendApprovalRequest(postId);
console.log('\n📨 카드 재발송 (후보 선택 버튼 포함)');

await prisma.$disconnect();
