import { prisma } from '../../src/db/prisma.js';

// v4 카드 (키 꿀렸다 버전) 어떤 포스트인지 — 같은 포스트임 (cmw9do07k)
// 사용자가 "이 건은 폐기해"라고 한 건 이전 카드들(v4 등)을 말하는 것
// 실제로는 같은 postId에 카피만 업데이트된 상태
// → 최신 v5 카피로 APPROVED 처리하면 됨

const postId = 'cmw9do07k00018c3jys5hiv31';

// 스케줄 설정 — 다른 쇼핑 예약과 겹치지 않게
// 현재 예약: 11/10 pikkseetem, 11/11 sookck.kate, 11/12 sookck.kate...
// sookck.kate 다음 빈 날짜 찾기
const existing = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    state: { in: ['APPROVED', 'PUBLISHED'] },
    scheduledAt: { not: null },
    account: { handle: 'sookck.kate' },
  },
  orderBy: { scheduledAt: 'desc' },
  take: 5,
});

console.log('sookck.kate 기존 예약:');
for (const p of existing) {
  const s = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
  console.log(`  ${s} | ${(p.generatedBody ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
}

// sookck.kate 마지막 예약일 + 2일 (격일)
const lastSched = existing[0]?.scheduledAt;
let schedDate: Date;
if (lastSched) {
  schedDate = new Date(lastSched.getTime() + 2 * 24 * 3600000);
} else {
  // 내일 오후 1시
  schedDate = new Date();
  schedDate.setDate(schedDate.getDate() + 1);
}
// 오후 1시 KST = UTC 04:00 + 랜덤 분
schedDate.setUTCHours(4, Math.floor(Math.random() * 20) + 5, 0, 0);

await prisma.post.update({
  where: { id: postId },
  data: {
    state: 'APPROVED',
    scheduledAt: schedDate,
  },
});

const schedStr = schedDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
console.log(`\n✅ APPROVED + 예약: ${schedStr}`);
console.log(`postId: ${postId}`);

await prisma.$disconnect();
