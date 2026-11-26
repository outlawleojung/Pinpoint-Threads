import { prisma } from '../../src/db/prisma.js';
import { uploadFromUrl } from '../../src/modules/shared/media-handler/index.js';
import { generateCustomBody } from '../../src/modules/shared/copywriter/index.js';
import { PostKind, PostState } from '@prisma/client';
import { execSync } from 'child_process';

const videoPath = '/Users/leones/Downloads/AQPJ5-cilqa5MnHR2z1aGvCqK3rhYXKr3ei_yL1u2HUg8QH0hEqvq5VScXttV12qBZ0cW6YpPWdpynN_PDn6AToNV7JYUcWpWvNTxvs.mp4';

// 1) 계정 선택 — minyoung.jung이 129h 전 마지막 발행으로 제일 오래됨
const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true, personaPrompt: true },
  orderBy: { handle: 'asc' },
});
for (const acc of accounts) {
  const last = await prisma.post.findFirst({
    where: { accountId: acc.id, state: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    select: { publishedAt: true },
  });
  const ago = last?.publishedAt ? Math.round((Date.now() - last.publishedAt.getTime()) / 3600000) : 999;
  console.log(`${acc.handle}: ${ago}h 전`);
}

// minyoung.jung 선택 (가장 오래 발행 안 함)
const target = accounts.find(a => a.handle === 'minyoung.jung')!;
console.log(`\n→ 선택: ${target.handle}\n`);

// 2) 프레임 추출 (ffmpeg)
const framePath = '/tmp/kitten-frame.jpg';
execSync(`ffmpeg -y -i "${videoPath}" -ss 3 -frames:v 1 -q:v 2 "${framePath}"`, { stdio: 'pipe' });
console.log('프레임 추출 완료');

// 3) Post 생성 (COPYWRITING)
const post = await prisma.post.create({
  data: {
    state: PostState.COPYWRITING,
    kind: PostKind.DAILY,
    accountId: target.id,
    sourceMediaUrls: [`file://${videoPath}`],
  },
});
console.log('Post 생성:', post.id);

// 4) Cloudinary 업로드 — 영상 + 프레임
const videoUp = await uploadFromUrl({ sourceUrl: videoPath, postId: post.id, resourceType: 'video' });
console.log('영상 업로드:', videoUp.publicUrl.slice(0, 80));

const frameUp = await uploadFromUrl({ sourceUrl: framePath, postId: post.id, resourceType: 'image' });
console.log('프레임 업로드:', frameUp.publicUrl.slice(0, 80));

const publicUrls = [videoUp.publicUrl, frameUp.publicUrl];

// 5) 카피 생성
const gen = await generateCustomBody({
  direction: '고양이 새끼 영상 — 인스타에서 가져온 귀여운 고양이 새끼 영상. 자연스러운 반응 한마디.',
  personaPrompt: target.personaPrompt,
  accountSeed: target.id,
  accountId: target.id,
  withReplyLead: false,
});
console.log('\n카피:', gen.body);

// 6) Post 업데이트 (holdApproval = PENDING_APPROVAL, 카드 미발송)
await prisma.post.update({
  where: { id: post.id },
  data: {
    state: PostState.PENDING_APPROVAL,
    mediaUrl: publicUrls[0],
    mediaUrls: publicUrls,
    generatedBody: gen.body,
  },
});

console.log(`\n✅ Post 생성 완료 (PENDING_APPROVAL, 카드 미발송)`);
console.log(`   계정: ${target.handle}`);
console.log(`   postId: ${post.id}`);
console.log(`   미디어: ${publicUrls.length}개`);

await prisma.$disconnect();
