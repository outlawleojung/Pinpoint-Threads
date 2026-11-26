import { prisma } from '../../src/db/prisma.js';
import { PostState } from '@prisma/client';

// 1. 대기 중 스하리 전부 폐기
const cancelled = await prisma.post.updateMany({
  where: { kind: 'SHARING', state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  data: { state: PostState.REJECTED, rejectionReason: '프롬프트 개편 후 재생성 (2026-11-22)' },
});
console.log(`🗑️ 스하리 ${cancelled.count}건 폐기\n`);

// 2. 새 프롬프트로 재생성
const { runSharingForAllAccounts } = await import('../../src/modules/pipeline-b/sharing-publisher/orchestrator.js');
const raw = await runSharingForAllAccounts();
const results = Array.isArray(raw) ? raw : (raw as any)?.results ?? [];

console.log('\n=== 새 스하리 결과 ===');
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

await prisma.$disconnect();
