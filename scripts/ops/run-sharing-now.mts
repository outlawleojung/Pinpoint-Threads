import { runSharingForAllAccounts } from '../../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

const result = await runSharingForAllAccounts();
for (const a of result.perAccount) {
  console.log(`${a.handle.padEnd(16)} | ${a.status} ${a.reason ?? ''}`);
}
console.log(`\n발송 ${result.sent} / 스킵 ${result.skipped} / 실패 ${result.failed}`);
process.exit(0);
