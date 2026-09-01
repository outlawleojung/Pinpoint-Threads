import 'dotenv/config';
import { GoogleTrendsAdapter } from '../src/modules/shared/trend-signals/adapters/google-trends.js';
import { CoupangRankingAdapter } from '../src/modules/shared/trend-signals/adapters/coupang-ranking.js';
import { filterAndGeneralize } from '../src/modules/shared/trend-signals/filter.js';

async function main() {
  const google = await new GoogleTrendsAdapter().fetchSignals();
  const coupang = await new CoupangRankingAdapter().fetchSignals();

  // Google Trends 10 + Coupang 상위 15 (카테고리별 다양)
  const sample = [
    ...google.slice(0, 10),
    ...coupang.slice(0, 15),
  ];
  console.log(`총 ${sample.length}개 신호 필터링 중...`);
  console.log(`  Google: ${google.length}개 중 상위 10개`);
  console.log(`  Coupang: ${coupang.length}개 중 상위 15개\n`);

  const results = await filterAndGeneralize(sample);

  console.log('=== KEEP ===');
  for (const r of results.filter((x) => x.keep)) {
    console.log(`  ✅ [${r.original.source}] "${r.original.keyword}"`);
    console.log(`      → 검색어: "${r.searchKeyword}" · 카테고리: ${r.category ?? '?'} · ${r.reason ?? ''}`);
  }

  console.log('\n=== DROP ===');
  for (const r of results.filter((x) => !x.keep)) {
    console.log(`  ❌ [${r.original.source}] "${r.original.keyword}"`);
    console.log(`      → ${r.reason ?? '?'}`);
  }

  const kept = results.filter((r) => r.keep).length;
  console.log(`\n요약: ${sample.length}개 중 ${kept}개 유지 (${Math.round((kept / sample.length) * 100)}%)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
