import 'dotenv/config';
import { CoupangAdapter } from '../src/infra/commerce/coupang-client.js';

async function testCoupang() {
  console.log('\n--- [쿠팡 Best Category API] ---');
  try {
    const c = new CoupangAdapter();
    const r = await c.bestByCategory(1001, 5); // 여성패션 top 5
    if (Array.isArray(r)) {
      console.log(`✅ 결과: ${r.length}개 상품`);
      r.slice(0, 2).forEach((item: any) =>
        console.log(`  ${item.productName?.substring(0, 60)} — ₩${item.productPrice}`),
      );
    } else {
      console.log('응답:', JSON.stringify(r).substring(0, 300));
    }
  } catch (e: any) {
    console.log(`❌ 에러: ${e.message}`);
  }
}

async function testGoogleTrendsRSS() {
  console.log('\n--- [Google Trends RSS] ---');
  try {
    const res = await fetch('https://trends.google.com/trending/rss?geo=KR');
    const text = await res.text();
    const titles = [...text.matchAll(/<title>([^<]+)<\/title>/g)]
      .map((m) => m[1])
      .filter((t) => t !== 'Daily Search Trends');
    console.log(`✅ 결과: ${titles.length}개 트렌드`);
    titles.slice(0, 5).forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  } catch (e: any) {
    console.log(`❌ 에러: ${e.message}`);
  }
}

async function testGoogleTrendsLib() {
  console.log('\n--- [Google Trends 라이브러리 (google-trends-api)] ---');
  try {
    const googleTrends = await import('google-trends-api');
    const raw = await googleTrends.default.dailyTrends({ geo: 'KR' });
    const data = JSON.parse(raw);
    const stories = data?.default?.trendingSearchesDays?.[0]?.trendingSearches ?? [];
    console.log(`✅ 결과: ${stories.length}개`);
    stories.slice(0, 3).forEach((s: any, i: number) => {
      console.log(`  ${i + 1}. ${s.title?.query ?? '?'} (${s.formattedTraffic ?? '?'})`);
    });
  } catch (e: any) {
    const msg = e.message?.substring(0, 100) ?? String(e);
    console.log(`❌ 에러: ${msg}`);
  }
}

async function testTikTokOembed() {
  console.log('\n--- [TikTok oEmbed] ---');
  // 다양한 URL 형식 시도
  const testUrls = [
    'https://www.tiktok.com/@khaby.lame/video/7325610633498475808',
    'https://vm.tiktok.com/ZMrHJHKqw/', // 단축 URL 예시
  ];
  for (const url of testUrls) {
    try {
      const oeUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const res = await fetch(oeUrl);
      if (res.ok) {
        const json = (await res.json()) as any;
        console.log(
          `✅ "${(json.title ?? '').substring(0, 50)}" by ${json.author_name ?? '?'}`,
        );
      } else {
        console.log(`❌ HTTP ${res.status}: ${(await res.text()).substring(0, 80)}`);
      }
    } catch (e: any) {
      console.log(`❌ ${e.message}`);
    }
  }
}

async function testThreadsOG() {
  console.log('\n--- [Threads HTML OG] ---');
  const res = await fetch('https://www.threads.net/@zuck/post/C9xVPfXpEYj', {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    redirect: 'follow',
  });
  const html = await res.text();
  const ogDesc =
    html.match(/property="og:description"\s+content="([^"]+)"/)?.[1] ??
    html.match(/content="([^"]+)"\s+property="og:description"/)?.[1];
  if (ogDesc && !ogDesc.includes('Log in') && !ogDesc.includes('Join Threads')) {
    console.log(`✅ "${ogDesc.substring(0, 80)}"`);
  } else {
    console.log(`❌ 로그인 벽: "${(ogDesc ?? '빈 응답').substring(0, 80)}"`);
  }

  // Googlebot UA 시도
  console.log('  (Googlebot UA 시도)');
  const res2 = await fetch('https://www.threads.net/@zuck/post/C9xVPfXpEYj', {
    headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
    redirect: 'follow',
  });
  const html2 = await res2.text();
  const ogDesc2 =
    html2.match(/property="og:description"\s+content="([^"]+)"/)?.[1] ??
    html2.match(/content="([^"]+)"\s+property="og:description"/)?.[1];
  if (ogDesc2 && !ogDesc2.includes('Log in') && !ogDesc2.includes('Join Threads')) {
    console.log(`  ✅ Googlebot으로 성공: "${ogDesc2.substring(0, 80)}"`);
  } else {
    console.log(`  ❌ Googlebot도 실패: "${(ogDesc2 ?? '빈 응답').substring(0, 80)}"`);
  }
}

async function testInstagramOG() {
  console.log('\n--- [Instagram HTML OG] ---');
  const res = await fetch('https://www.instagram.com/p/C1JmR2pPZSi/', {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
  });
  const html = await res.text();
  const ogDesc =
    html.match(/property="og:description"\s+content="([^"]+)"/)?.[1] ??
    html.match(/content="([^"]+)"\s+property="og:description"/)?.[1];
  if (ogDesc && ogDesc.length > 30 && !ogDesc.toLowerCase().includes('log in')) {
    console.log(`✅ "${ogDesc.substring(0, 80)}"`);
  } else {
    console.log(`❌ 빈 OG 또는 로그인 벽: "${(ogDesc ?? '없음').substring(0, 80)}"`);
  }
}

async function testNaverDatalab() {
  console.log('\n--- [네이버 데이터랩 API] ---');
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    console.log('⚪ 미설정 (NAVER_CLIENT_ID/SECRET 없음)');
    return;
  }
  try {
    const res = await fetch(
      'https://openapi.naver.com/v1/datalab/shopping/categories',
      {
        method: 'POST',
        headers: {
          'X-Naver-Client-Id': id,
          'X-Naver-Client-Secret': secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          timeUnit: 'date',
          category: [{ name: '패션의류', param: ['50000000'] }],
        }),
      },
    );
    if (res.ok) {
      const json = (await res.json()) as any;
      console.log(`✅ ${JSON.stringify(json).substring(0, 150)}`);
    } else {
      console.log(`❌ HTTP ${res.status}: ${await res.text()}`);
    }
  } catch (e: any) {
    console.log(`❌ 에러: ${e.message}`);
  }
}

async function main() {
  console.log('==========================================');
  console.log('  전체 데이터 소스 실 검증 v2');
  console.log('==========================================');

  await testThreadsOG();
  await testInstagramOG();
  await testTikTokOembed();
  await testGoogleTrendsLib();
  await testGoogleTrendsRSS();
  await testCoupang();
  await testNaverDatalab();

  console.log('\n==========================================');
  console.log('  요약');
  console.log('==========================================\n');
  process.exit(0);
}

main();
