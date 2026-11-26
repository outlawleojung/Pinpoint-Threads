// 2026-11-26 전체 정리 — 좀비 FAILED + 격일 위반 스하리 PENDING REJECT + 일상 PENDING 상태 진단
import { prisma } from '../../src/db/prisma.js';

// 1. 좀비 처리 (CLASSIFYING/MATCHING/COPYWRITING/PUBLISHING 2h+)
console.log('=== [1] 좀비 FAILED 처리 ===');
const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
const zombies = await prisma.post.findMany({
  where: {
    state: { in: ['CLASSIFYING', 'MATCHING', 'COPYWRITING', 'PUBLISHING'] },
    updatedAt: { lt: twoHoursAgo },
  },
  select: { id: true, kind: true, state: true, createdAt: true, account: { select: { handle: true } } },
});
for (const z of zombies) {
  const hours = ((Date.now() - z.createdAt.getTime()) / 3600_000).toFixed(0);
  await prisma.post.update({
    where: { id: z.id },
    data: { state: 'FAILED', rejectionReason: `zombie ${z.state} ${hours}h stuck` },
  });
  console.log(`  FAILED @${z.account.handle} ${z.kind} [${z.state}] ${hours}h`);
}
console.log(`  총 ${zombies.length}건 처리\n`);

// 2. 스하리 격일 위반 PENDING 체크
// 각 계정 최근 published/approved 스하리 날짜 → 그 이후 2일 이내 PENDING 은 거부
console.log('=== [2] 스하리 격일 위반 PENDING_APPROVAL REJECT ===');
const HANDLES = ['pikkseetem', 'minyoung.jung', 'hanseoa.pick', 'kle0_lee'];
let sharingRejected = 0;
for (const handle of HANDLES) {
  const acc = await prisma.account.findFirst({ where: { handle } });
  if (!acc) continue;

  // 최근 7일 published/approved 스하리의 모든 날짜
  const since = new Date(Date.now() - 7 * 864e5);
  const refPosts = await prisma.post.findMany({
    where: {
      accountId: acc.id, kind: 'SHARING',
      state: { in: ['PUBLISHED', 'APPROVED', 'PUBLISHING'] },
      OR: [
        { publishedAt: { gte: since } },
        { scheduledAt: { gte: since } },
      ],
    },
    select: { publishedAt: true, scheduledAt: true },
  });
  const refDays = new Set(refPosts.map(p => {
    const when = p.publishedAt ?? p.scheduledAt;
    return when ? Math.floor(when.getTime() / 864e5) : null;
  }).filter((d): d is number => d !== null));

  // PENDING 스하리 중, 다음에 발행된다면 격일 위반일 것
  const pending = await prisma.post.findMany({
    where: { accountId: acc.id, kind: 'SHARING', state: 'PENDING_APPROVAL' },
    select: { id: true, createdAt: true },
  });
  for (const p of pending) {
    // 다음 발행 예상일: 오늘 또는 내일 아침
    const predictedDay = Math.floor(Date.now() / 864e5);  // 오늘
    const prevDay = predictedDay - 1;
    const nextDay = predictedDay + 1;
    if (refDays.has(prevDay) || refDays.has(predictedDay) || refDays.has(nextDay)) {
      await prisma.post.update({
        where: { id: p.id },
        data: { state: 'REJECTED', rejectionReason: '격일 위반 (인접일에 이미 스하리 있음) — 2026-11-26 자동 정리' },
      });
      console.log(`  REJECT @${handle} ${p.id.slice(-8)} (${p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
      sharingRejected++;
    }
  }
}
console.log(`  총 ${sharingRejected}건 처리\n`);

// 3. 일상 PENDING 진단
console.log('=== [3] 일상 PENDING_APPROVAL 진단 ===');
const dailyPending = await prisma.post.findMany({
  where: { kind: 'DAILY', state: 'PENDING_APPROVAL' },
  select: {
    id: true, createdAt: true, telegramMessageId: true,
    account: { select: { handle: true } },
    generatedBody: true,
  },
  orderBy: { createdAt: 'asc' },
});
console.log(`  PENDING: ${dailyPending.length}건`);
let noTg = 0, oldPending = 0;
for (const p of dailyPending) {
  const hours = ((Date.now() - p.createdAt.getTime()) / 3600_000).toFixed(0);
  if (!p.telegramMessageId) noTg++;
  if (parseInt(hours) > 48) oldPending++;
  console.log(`  @${p.account.handle} ${hours}h | tg:${p.telegramMessageId ?? '없음'} | ${(p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 40)}`);
}
console.log(`  telegram 카드 없음: ${noTg}건, 48h+ 묵은 것: ${oldPending}건`);

await prisma.$disconnect();
