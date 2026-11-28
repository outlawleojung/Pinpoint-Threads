// 스하리 저녁 크론 수동 실행 — 전 계정 순회, DEDUP 체크 후 카피 생성 + 승인 카드 발송
import { runSharingForAllAccounts } from '../../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

console.log('═══ 스하리 전 계정 배치 시작 ═══\n');
const summary = await runSharingForAllAccounts();
console.log('\n═══ 결과 ═══');
console.log(`total: ${summary.total}, sent: ${summary.sent}, skipped: ${summary.skipped}, failed: ${summary.failed}`);
for (const a of summary.perAccount) {
  console.log(`  @${a.handle.padEnd(16)} [${a.status}] ${a.reason ?? ''}`);
}
process.exit(0);
