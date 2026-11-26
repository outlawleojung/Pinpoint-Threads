import { runShoppingForAllAccounts } from '../../src/modules/pipeline-a/shopping-publisher/orchestrator.js';

console.log('=== 쇼핑 크론 수동 실행 ===\n');
const summary = await runShoppingForAllAccounts();
console.log('\n결과:', JSON.stringify(summary, null, 2));
