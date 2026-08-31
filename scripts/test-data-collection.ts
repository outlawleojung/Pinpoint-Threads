import 'dotenv/config';
import { ingestUrl } from '../src/modules/shared/url-ingester/index.js';
import { prisma } from '../src/db/prisma.js';

async function main() {
  console.log('\n========================================');
  console.log('  데이터 수집 파이프라인 e2e 테스트');
  console.log('========================================\n');

  // --- Test 1: TikTok URL (oEmbed, 로그인 불필요) ---
  console.log('--- [1] TikTok URL 인제스트 ---');
  try {
    const r = await ingestUrl({
      url: 'https://www.tiktok.com/@khaby.lame/video/7325610633498475808',
      source: 'MANUAL_TELEGRAM',
    });
    console.log(`상태: ${r.status} | ${r.message}\n`);
  } catch (err: any) {
    console.error(`TikTok 에러: ${err.message}\n`);
  }

  // --- Test 2: Threads URL (OG 파싱 — 로그인 벽 예상) ---
  console.log('--- [2] Threads URL 인제스트 ---');
  try {
    const r = await ingestUrl({
      url: 'https://www.threads.net/@zuck/post/C9xVPfXpEYj',
      source: 'MANUAL_TELEGRAM',
    });
    console.log(`상태: ${r.status} | ${r.message}\n`);
  } catch (err: any) {
    console.error(`Threads 에러: ${err.message}\n`);
  }

  // --- Test 3: Instagram URL (OG 파싱) ---
  console.log('--- [3] Instagram URL 인제스트 ---');
  try {
    const r = await ingestUrl({
      url: 'https://www.instagram.com/p/C1JmR2pPZSi/',
      source: 'MANUAL_TELEGRAM',
    });
    console.log(`상태: ${r.status} | ${r.message}\n`);
  } catch (err: any) {
    console.error(`Instagram 에러: ${err.message}\n`);
  }

  // --- DB 상태 확인 ---
  console.log('--- DB 상태 ---');
  const links = await prisma.inboundLink.findMany({
    select: {
      id: true,
      platform: true,
      status: true,
      rawText: true,
      authorHandle: true,
      mediaUrls: true,
      rawLanguage: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  for (const l of links) {
    console.log(
      `  [${l.platform}] ${l.status} | 저자:${l.authorHandle ?? '?'} | 본문:${(l.rawText ?? '').length}자 | 미디어:${l.mediaUrls.length} | 언어:${l.rawLanguage ?? '?'}`,
    );
  }

  const benchmarks = await prisma.benchmarkPost.count();
  const trends = await prisma.trendSignal.count();
  console.log(`\n벤치마크: ${benchmarks}건 | 트렌드 시그널: ${trends}건`);

  await prisma.$disconnect();
  process.exit(0);
}

main();
