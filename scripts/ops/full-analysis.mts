import { prisma } from '../../src/db/prisma.js';
import { isShoppingEligible, feedReachStats, isCollapsedAccount, linkRatioBlock } from '../../src/modules/pipeline-a/reach-health.js';

const now = new Date();
const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const twoWeeks = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

const accs = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true, followersCount: true },
  orderBy: { handle: 'asc' },
});

for (const a of accs) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${a.handle}] 팔로워: ${a.followersCount}`);
  console.log('='.repeat(60));

  const elig = await isShoppingEligible(a.id, a.followersCount);
  const stats = await feedReachStats(a.id);
  const collapsed = await isCollapsedAccount(a.id);
  const linkBlock = await linkRatioBlock(a.id);
  console.log(`  쇼핑 적격: ${elig.ok ? '✅' : '❌'} — ${elig.reason}`);
  console.log(`  도달(21일): ${stats ? `중앙값=${stats.median}, 최대=${stats.max}, 표본=${stats.n}` : '표본 부족'}`);
  console.log(`  붕괴: ${collapsed ? '⚠️ YES' : '정상'}`);
  if (linkBlock) console.log(`  링크 비율 차단: ${linkBlock}`);

  // 최근 7일 발행
  const posts7d = await prisma.post.findMany({
    where: { accountId: a.id, state: 'PUBLISHED', publishedAt: { gte: week } },
    select: { kind: true },
  });
  const daily7 = posts7d.filter(p => p.kind === 'DAILY').length;
  const sharing7 = posts7d.filter(p => p.kind === 'SHARING').length;
  const shopping7 = posts7d.filter(p => p.kind === 'SHOPPING').length;
  console.log(`  최근 7일 발행: 일상 ${daily7} · 스하리 ${sharing7} · 쇼핑 ${shopping7}`);

  // 최근 14일 총
  const posts14d = await prisma.post.count({
    where: { accountId: a.id, state: 'PUBLISHED', publishedAt: { gte: twoWeeks } },
  });
  console.log(`  최근 14일 발행: 총 ${posts14d}건`);

  // 최근 5개 글 조회수
  const recent5 = await prisma.post.findMany({
    where: { accountId: a.id, state: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    take: 5,
    select: {
      kind: true, publishedAt: true,
      insightSnapshots: { select: { views: true, likes: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
    },
  });
  console.log(`  최근 5개 글:`);
  for (const p of recent5) {
    const v = p.insightSnapshots[0];
    const kindKo = p.kind === 'SHOPPING' ? '쇼핑' : p.kind === 'SHARING' ? '스하리' : '일상';
    const date = p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : '?';
    console.log(`    ${date} ${kindKo}: ${v ? `${v.views}뷰 · ${v.likes}좋아요` : '스냅샷 없음'}`);
  }

  // 대기 중
  const pending = await prisma.post.findMany({
    where: { accountId: a.id, state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
    select: { id: true, kind: true, state: true, scheduledAt: true },
  });
  if (pending.length > 0) {
    console.log(`  대기 중: ${pending.length}건`);
    for (const p of pending) {
      const kindKo = p.kind === 'SHOPPING' ? '쇼핑' : p.kind === 'SHARING' ? '스하리' : '일상';
      console.log(`    ${kindKo} ${p.state} (${p.id.slice(-8)}) ${p.scheduledAt ? `예약: ${p.scheduledAt.toISOString().slice(0, 16)}` : ''}`);
    }
  }

  // 마지막 스하리
  const lastSharing = await prisma.post.findFirst({
    where: { accountId: a.id, kind: 'SHARING', state: { notIn: ['REJECTED', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, state: true, publishedAt: true },
  });
  if (lastSharing) {
    const hrs = Math.round((now.getTime() - lastSharing.createdAt.getTime()) / 3600000);
    console.log(`  마지막 스하리: ${lastSharing.publishedAt?.toISOString().slice(0, 16) ?? lastSharing.createdAt.toISOString().slice(0, 16)} (${hrs}h 전, ${lastSharing.state})`);
  }
}

// 휴식 계정
const inactive = await prisma.account.findMany({
  where: { isActive: false },
  select: { handle: true, followersCount: true },
});
if (inactive.length > 0) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('휴식 계정:');
  for (const a of inactive) console.log(`  ${a.handle} (팔로워 ${a.followersCount})`);
}

await prisma.$disconnect();
