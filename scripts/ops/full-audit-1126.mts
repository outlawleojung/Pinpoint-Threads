// 전체 파이프라인 상태 감사 — 쇼핑/스하리/일상 x 4계정 x 과거7d·향후14d
import { prisma } from '../../src/db/prisma.js';

const now = new Date();
const past = new Date(Date.now() - 7 * 864e5);
const future = new Date(Date.now() + 14 * 864e5);

const HANDLES = ['pikkseetem', 'minyoung.jung', 'hanseoa.pick', 'kle0_lee'];
const KINDS = ['SHOPPING', 'SHARING', 'DAILY'] as const;

for (const kind of KINDS) {
  console.log(`\n${'═'.repeat(60)}\n### ${kind}\n${'═'.repeat(60)}`);
  for (const handle of HANDLES) {
    const acc = await prisma.account.findFirst({ where: { handle } });
    if (!acc) continue;

    // 과거 7일 발행
    const published = await prisma.post.findMany({
      where: { accountId: acc.id, kind, publishedAt: { gte: past } },
      select: { publishedAt: true }, orderBy: { publishedAt: 'asc' },
    });
    const pubDays = [...new Set(published.map(p => p.publishedAt!.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' })))];

    // 예약 (APPROVED + scheduledAt 미래)
    const scheduled = await prisma.post.findMany({
      where: { accountId: acc.id, kind, state: 'APPROVED', scheduledAt: { gte: now } },
      select: { scheduledAt: true }, orderBy: { scheduledAt: 'asc' },
    });
    const schDays = scheduled.map(p => p.scheduledAt!.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }));

    // 대기
    const pending = await prisma.post.count({
      where: { accountId: acc.id, kind, state: 'PENDING_APPROVAL' },
    });

    // 좀비 (CLASSIFYING/MATCHING/COPYWRITING/PUBLISHING > 2h)
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    const zombies = await prisma.post.count({
      where: {
        accountId: acc.id, kind,
        state: { in: ['CLASSIFYING', 'MATCHING', 'COPYWRITING', 'PUBLISHING'] },
        updatedAt: { lt: twoHoursAgo },
      },
    });

    const lastPub = published[published.length - 1];
    const sinceLastPub = lastPub ? ((Date.now() - lastPub.publishedAt!.getTime()) / 3600_000).toFixed(0) + 'h' : '(없음)';

    console.log(`\n@${handle.padEnd(16)} 최근발행: ${sinceLastPub} 전`);
    console.log(`  과거7d PUBLISHED (${pubDays.length}일): ${pubDays.join(', ') || '-'}`);
    console.log(`  미래 APPROVED (${schDays.length}건): ${schDays.join(', ') || '-'}`);
    console.log(`  PENDING_APPROVAL: ${pending}건`);
    if (zombies > 0) console.log(`  ⚠️ 좀비(2h+ stuck): ${zombies}건`);
  }
}

await prisma.$disconnect();
