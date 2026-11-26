import { prisma } from '../../src/db/prisma.js';

// 1. 전체 PUBLISHED 쇼핑 포스트 중 reply 실패 비율
const allPublished = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PUBLISHED' },
  select: {
    id: true,
    threadsPostId: true,
    threadsReplyId: true,
    replyFailureReason: true,
    publishedAt: true,
    account: { select: { handle: true } },
    mediaUrls: true,
  },
  orderBy: { publishedAt: 'desc' },
});

const withReply = allPublished.filter(p => p.threadsReplyId);
const noReply = allPublished.filter(p => !p.threadsReplyId);
const withFailure = allPublished.filter(p => p.replyFailureReason);

console.log(`=== 쇼핑 PUBLISHED 댓글 실패 통계 ===`);
console.log(`총 PUBLISHED 쇼핑: ${allPublished.length}건`);
console.log(`댓글 성공: ${withReply.length}건`);
console.log(`댓글 없음 (threadsReplyId=null): ${noReply.length}건`);
console.log(`실패 사유 기록: ${withFailure.length}건`);

console.log(`\n=== 댓글 실패 건 상세 ===`);
for (const p of noReply) {
  const hasVideo = (p.mediaUrls ?? []).some((u: string) => /\.mp4/i.test(u) || u.includes('/video/upload/'));
  console.log(`  ${p.id.slice(-8)} | ${p.account.handle.padEnd(14)} | ${p.publishedAt?.toISOString().slice(0, 16) ?? '?'} | video=${hasVideo}`);
  if (p.replyFailureReason) {
    console.log(`    사유: ${p.replyFailureReason.slice(0, 200)}`);
  }
}

// 2. 성공한 건 중 비디오 vs 이미지 비율
const successVideo = withReply.filter(p => (p.mediaUrls ?? []).some((u: string) => /\.mp4/i.test(u) || u.includes('/video/upload/')));
const successImage = withReply.filter(p => !(p.mediaUrls ?? []).some((u: string) => /\.mp4/i.test(u) || u.includes('/video/upload/')));
console.log(`\n=== 성공 건 미디어 타입 ===`);
console.log(`비디오 포함: ${successVideo.length}건`);
console.log(`이미지만: ${successImage.length}건`);

// 3. FAILED 상태 포스트 중 reply 관련 실패
const failed = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'FAILED' },
  select: {
    id: true, rejectionReason: true,
    account: { select: { handle: true } },
    createdAt: true,
  },
  orderBy: { createdAt: 'desc' },
  take: 10,
});
if (failed.length) {
  console.log(`\n=== FAILED 쇼핑 포스트 (최근 10건) ===`);
  for (const f of failed) {
    console.log(`  ${f.id.slice(-8)} | ${f.account.handle} | ${f.createdAt.toISOString().slice(0, 16)} | ${(f.rejectionReason ?? '').slice(0, 100)}`);
  }
}

await prisma.$disconnect();
