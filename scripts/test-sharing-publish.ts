import 'dotenv/config';
import { runSharingForAllAccounts } from '../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

async function main() {
  console.log('=== Pipeline B 스하리 발행 (수동 트리거) ===\n');
  const summary = await runSharingForAllAccounts();
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
