import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { promoteInboundLink } from '../src/modules/shared/source-collector/promoter.js';
import { runPipelineA } from '../src/modules/pipeline-a/orchestrator.js';

/**
 * 인자로 InboundLink id 하나 + 계정 handle 하나 받아서:
 *   1) 수동 승격 (미승격 시)
 *   2) 해당 계정으로 Pipeline A 발행 (RAG 자동 활용 · Copywriter 내부에서 similar 벤치마크 조회)
 *
 * 사용: npx tsx scripts/promote-and-pipeline-a.ts <inboundLinkId> <account_handle>
 */

async function main() {
  const inboundLinkId = process.argv[2];
  const accountHandle = process.argv[3];
  if (!inboundLinkId || !accountHandle) {
    console.error('Usage: npx tsx scripts/promote-and-pipeline-a.ts <inboundLinkId> <account_handle>');
    process.exit(1);
  }

  const link = await prisma.inboundLink.findUniqueOrThrow({ where: { id: inboundLinkId } });
  const account = await prisma.account.findFirstOrThrow({ where: { handle: accountHandle } });

  console.log(`Inbound: @${link.authorHandle} · ${link.platform} · media=${link.mediaUrls.length}`);
  console.log(`Target account: @${account.handle}\n`);

  // 1. 승격 (이미 됐으면 no-op)
  const promoteResult = await promoteInboundLink(inboundLinkId, 'manual');
  console.log(`Promote: ${promoteResult.status} ${promoteResult.reason ?? ''}`);

  if (link.mediaUrls.length < 2) {
    console.error(`⚠️  Media count ${link.mediaUrls.length} < 2, Pipeline A는 미디어 2+ 필요`);
    process.exit(1);
  }

  // 2. Pipeline A
  console.log('\n=== Pipeline A 실행 ===');
  const outcome = await runPipelineA({
    accountId: account.id,
    sourceMediaUrls: link.mediaUrls,
    sourceText: link.rawText ?? '',
    sourceUrl: link.url,
    language: link.rawLanguage ?? undefined,
  });
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
