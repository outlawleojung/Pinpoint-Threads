import 'dotenv/config';
import { collectSharingBenchmarks } from '../src/modules/pipeline-b/sharing-collector/index.js';

async function main() {
  console.log('=== Pipeline B 스하리 해시태그 수집 (수동 실행) ===\n');
  const summary = await collectSharingBenchmarks();
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
