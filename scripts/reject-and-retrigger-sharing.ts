import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { runSharingForAllAccounts } from '../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

async function main() {
  // 1. 오늘 아침 만들어진 PENDING_APPROVAL SHARING 포스트 REJECTED 로 (dedup 우회)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const stale = await prisma.post.updateMany({
    where: {
      kind: 'SHARING',
      state: 'PENDING_APPROVAL',
      createdAt: { gte: todayStart },
    },
    data: {
      state: 'REJECTED',
      rejectionReason: '자동: 템플릿 획일화 카피 폐기, RAG+계정 컨텍스트 반영 재생성',
    },
  });
  console.log(`오늘 아침 PENDING 카피 ${stale.count}건 REJECTED 처리`);

  // 2. 새 카피 재생성 → 승인 카드 재전송
  const summary = await runSharingForAllAccounts();
  console.log('\n=== 재생성 결과 ===');
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
