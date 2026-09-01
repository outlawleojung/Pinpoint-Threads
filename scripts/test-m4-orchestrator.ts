import 'dotenv/config';
import { GoogleTrendsAdapter } from '../src/modules/shared/trend-signals/adapters/google-trends.js';
import { CoupangRankingAdapter } from '../src/modules/shared/trend-signals/adapters/coupang-ranking.js';
import { pollAllAdapters } from '../src/modules/shared/trend-signals/index.js';
import { safeRunTrendSearchIngest } from '../src/modules/shared/trend-signals/search-orchestrator.js';

async function main() {
  console.log('=== STEP 1. 트렌드 신호 폴링 ===');
  const summary = await pollAllAdapters([
    new GoogleTrendsAdapter(),
    new CoupangRankingAdapter(),
  ]);
  console.log(JSON.stringify(summary, null, 2));

  console.log('\n=== STEP 2. 필터 → 검색 → 인제스트 (상위 2 시그널만) ===');
  const result = await safeRunTrendSearchIngest({
    topSignals: 2,          // 소량 (비용 절감)
    perPlatformResults: 5,  // 플랫폼당 5개
    minLikes: 100,
  });
  console.log(JSON.stringify(result, null, 2));

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
