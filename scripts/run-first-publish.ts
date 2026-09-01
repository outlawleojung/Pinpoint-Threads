import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { runPipelineA } from '../src/modules/pipeline-a/orchestrator.js';

/**
 * Task #19 실 발행 e2e — Pipeline A 트리거
 * 지정: 계정 @kle0_lee · 벤치마크 @owl.6540509 아식스 신발
 * 결과: 승인 카드 텔레그램 발송 → 사용자 승인 클릭 → 실 발행
 */
async function main() {
  const accountHandle = process.argv[2] ?? 'kle0_lee';
  const benchmarkHandle = process.argv[3] ?? 'owl.6540509';

  const account = await prisma.account.findFirst({ where: { handle: accountHandle } });
  if (!account) throw new Error(`account @${accountHandle} not found`);

  const bench = await prisma.benchmarkPost.findFirst({
    where: { sourceHandle: benchmarkHandle },
    orderBy: { likesCount: 'desc' },
  });
  if (!bench) throw new Error(`benchmark @${benchmarkHandle} not found`);
  if (bench.mediaUrls.length < 2) throw new Error(`benchmark media < 2 (${bench.mediaUrls.length})`);

  console.log(`발행 대상 계정: @${account.handle}`);
  console.log(`참고 벤치마크: @${bench.sourceHandle} (👍${bench.likesCount})`);
  console.log(`벤치마크 본문: ${bench.text.slice(0, 100).replace(/\n/g, ' ')}...`);
  console.log(`벤치마크 미디어: ${bench.mediaUrls.length}장\n`);

  const result = await runPipelineA({
    accountId: account.id,
    sourceMediaUrls: bench.mediaUrls,
    sourceText: bench.text,
    sourceUrl: bench.permalink,
    language: 'ko',
  });

  console.log('\n=== 결과 ===');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
