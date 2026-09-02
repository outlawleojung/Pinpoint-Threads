import 'dotenv/config';
import { syncAllAccountMetrics } from '../src/modules/pipeline-b/sharing-copywriter/follower-sync.js';

async function main() {
  console.log('=== 계정 metrics 동기화 ===\n');
  const r = await syncAllAccountMetrics();
  console.table(r);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
