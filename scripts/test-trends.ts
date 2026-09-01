import 'dotenv/config';
import { GoogleTrendsAdapter } from '../src/modules/shared/trend-signals/adapters/google-trends.js';
import { NaverDatalabAdapter } from '../src/modules/shared/trend-signals/adapters/naver-datalab.js';
import { CoupangRankingAdapter } from '../src/modules/shared/trend-signals/adapters/coupang-ranking.js';

async function main() {
  console.log('=== 1. Google Trends RSS ===');
  try {
    const google = new GoogleTrendsAdapter();
    const signals = await google.fetchSignals();
    console.log(`fetched ${signals.length} signals`);
    signals.slice(0, 10).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.keyword} (traffic=${s.currentValue})`);
    });
  } catch (err: any) {
    console.log(`ERR: ${err.message}`);
  }

  console.log('\n=== 2. Naver DataLab ===');
  try {
    const naver = new NaverDatalabAdapter();
    const signals = await naver.fetchSignals();
    console.log(`fetched ${signals.length} signals`);
    signals.slice(0, 10).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.keyword} (value=${s.currentValue})`);
    });
  } catch (err: any) {
    console.log(`ERR: ${err.message}`);
  }

  console.log('\n=== 3. Coupang Best Ranking ===');
  try {
    const coupang = new CoupangRankingAdapter();
    const signals = await coupang.fetchSignals();
    console.log(`fetched ${signals.length} signals`);
    signals.slice(0, 10).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.keyword} (value=${s.currentValue})`);
    });
  } catch (err: any) {
    console.log(`ERR: ${err.message}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
