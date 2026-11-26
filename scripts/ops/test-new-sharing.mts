import { runSharingForAllAccounts } from '../../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

console.log('=== 새 프롬프트로 스하리 테스트 생성 ===\n');
const results = await runSharingForAllAccounts();
for (const r of results) {
  if (r.status === 'ok') {
    for (const v of r.variants ?? []) {
      const body = (v.body ?? '').replace(/\n/g, ' / ').slice(0, 80);
      console.log(`  ✅ @${(r.handle ?? '?').padEnd(16)} ${body}`);
    }
  } else {
    console.log(`  ❌ @${r.handle ?? '?'} — ${r.reason ?? r.status}`);
  }
}

const { prisma } = await import('../../src/db/prisma.js');
await prisma.$disconnect();
