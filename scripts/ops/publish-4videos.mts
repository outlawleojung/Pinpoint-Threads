import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../../src/db/prisma.js';
import { env } from '../../src/config/env.js';
import { generateDailyBody } from '../../src/modules/shared/copywriter/index.js';
import * as fs from 'fs';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

async function uploadLocal(filePath: string, postId: string, resourceType: 'image' | 'video'): Promise<string> {
  const folder = `${env.CLOUDINARY_UPLOAD_FOLDER}/${postId}`;
  const result = await cloudinary.uploader.upload(filePath, {
    folder,
    resource_type: resourceType,
    ...(resourceType === 'video' ? { eager: 'w_720,q_auto' } : {}),
  });
  console.log(`  업로드: ${resourceType} → ${result.secure_url} (${Math.round(result.bytes / 1024)}KB)`);
  return result.secure_url;
}

const SCRATCH = '/private/tmp/claude-501/-Users-leones-Documents-Pinpoint-Threads/e0afc4fe-cd6a-4190-b42f-9008f600a54d/scratchpad/frames';

interface VideoItem {
  videoPath: string;
  capturePath: string;
  description: string; // 영상 내용 설명 (mediaDescription용)
}

const items: VideoItem[] = [
  {
    videoPath: '/Users/leones/Downloads/AQN1SnOqQNsi1wQYVqLvO3VJU5JTGgfNUY5RtDntrwfPUr2j5pqbuDrb1Atzv0YmxieQ_M5-ogzZLCkhH3vPJMTN6hjVvaTxM7sw0_g.mp4',
    capturePath: `${SCRATCH}/cap1.jpg`,
    description: '회색+흰색 고양이(브숏)가 선반 위에 앉아있고, 사람이 손을 내밀면 앞발로 톡톡 치며 반응하는 영상. 뒤에 건담/에반게리온 피규어가 보임.',
  },
  {
    videoPath: '/Users/leones/Downloads/AQMh6UUUOXJpQVbfRmsbEFkbYYBZAON0UWiJmHCl20zRcsux5ofepkN1H-4O7r0zPEo_x_KTZS9_BovhLNAkz2xd8dFixzqY-iKJK4k.mp4',
    capturePath: `${SCRATCH}/cap2.jpg`,
    description: '회색 브리티시숏헤어 새끼고양이 4마리가 소파 위에서 뒤뚱뒤뚱 돌아다니며 카메라 쪽으로 다가오는 영상. 아직 작고 어린 아기 고양이들.',
  },
  {
    videoPath: '/Users/leones/Downloads/AQMP-K6uOjhOflcrtYYhIy0RgQ5hQUftU9FUJ8hf-Jk_TXdbRYx8kYS0E9ESacBpgNPmL228HBNutUsuBOHyR5_-XhDJ5V963pGvNUM.mp4',
    capturePath: `${SCRATCH}/cap3.jpg`,
    description: '삼색(칼리코) 고양이가 공원 보도 위를 걸어가는 영상. 매우 통통(뚱뚱)한 길고양이가 짧은 다리로 뒤뚱뒤뚱 걸어감.',
  },
  {
    videoPath: '/Users/leones/Downloads/AQO0qyY1Z24vfDkMOoRMrO1rngXWBApJA2w1VSRP2IffSnj3YTUpa_3tAB442klO8HZZEOziQhpRXboZoCp20weW30exAVdTJ67h0WI.mp4',
    capturePath: `${SCRATCH}/cap4.jpg`,
    description: '아기 수달이 사람 손가락을 앙 깨물고, 머리에 머리끈을 올려놓은 채 카메라를 동글동글한 눈으로 쳐다보는 영상.',
  },
];

// 계정 배정: 오늘 카드 적은 계정 우선
const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true, personaPrompt: true },
});

// 오늘 이미 카드 보낸/대기중인 DAILY 수 확인
const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);

const todayPosts = await prisma.post.findMany({
  where: {
    kind: 'DAILY',
    createdAt: { gte: todayStart },
    state: { notIn: ['REJECTED', 'FAILED'] },
  },
  select: { accountId: true },
});

const todayCountMap = new Map<string, number>();
for (const p of todayPosts) {
  todayCountMap.set(p.accountId, (todayCountMap.get(p.accountId) ?? 0) + 1);
}

// 오늘 DAILY가 적은 순으로 정렬
const sorted = [...accounts].sort((a, b) => {
  return (todayCountMap.get(a.id) ?? 0) - (todayCountMap.get(b.id) ?? 0);
});

console.log('계정 배정 (오늘 DAILY 수 기준):');
for (const acc of sorted) {
  console.log(`  ${acc.handle}: 오늘 DAILY ${todayCountMap.get(acc.id) ?? 0}건`);
}

// 상위 4계정 배정
const assigned = sorted.slice(0, 4);

const results: Array<{ handle: string; postId: string; body: string }> = [];

for (let i = 0; i < items.length; i++) {
  const item = items[i]!;
  const acc = assigned[i]!;
  console.log(`\n=== 영상${i + 1}: ${acc.handle} ===`);

  // 1. Post 생성 (DRAFT)
  const post = await prisma.post.create({
    data: {
      accountId: acc.id,
      kind: 'DAILY',
      state: 'DRAFT',
    },
  });
  console.log(`  Post 생성: ${post.id}`);

  // 2. Cloudinary 업로드
  const videoUrl = await uploadLocal(item.videoPath, post.id, 'video');
  const imageUrl = await uploadLocal(item.capturePath, post.id, 'image');

  // 3. 카피 생성 (mediaDescription 기반)
  console.log('  카피 생성 중...');
  let rationale: unknown;
  const body = await generateDailyBody({
    personaPrompt: acc.personaPrompt ?? undefined,
    accountSeed: `${acc.id}:manual:${Date.now()}`,
    accountId: acc.id,
    mediaDescription: item.description,
    frameImageUrls: [imageUrl],
    onRationale: (r) => { rationale = r; },
  });

  // 4. Post 업데이트 → PENDING_APPROVAL (카드 미발송)
  await prisma.post.update({
    where: { id: post.id },
    data: {
      state: 'PENDING_APPROVAL',
      generatedBody: body,
      mediaUrls: [videoUrl, imageUrl],
      sourceMediaUrls: [],
      sourceBrief: { rationale: rationale ?? null } as never,
    },
  });

  console.log(`  카피: ${body}`);
  console.log(`  상태: PENDING_APPROVAL (카드 미발송)`);
  results.push({ handle: acc.handle, postId: post.id, body });
}

console.log('\n=== 전체 결과 ===');
for (const r of results) {
  console.log(`[${r.handle}] ${r.postId}`);
  console.log(`  "${r.body.replace(/\n/g, ' / ')}"`);
}

await prisma.$disconnect();
