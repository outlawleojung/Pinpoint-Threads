import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { promoteInboundLink } from '../src/modules/shared/source-collector/promoter.js';
import { runPipelineA } from '../src/modules/pipeline-a/orchestrator.js';

interface Assignment { authorHandle: string; accountHandle: string }

async function main() {
  // 미승격 인바운드 2건 + 계정 매칭
  const assignments: Assignment[] = [
    { authorHandle: 'mon.i1l', accountHandle: 'sookck.kate' },   // 파운데이션·뷰티 → 20대 감성
    { authorHandle: 'n___nm25', accountHandle: '_blanchatt_' },   // 양말 실속 → 40대 실용
  ];

  for (const a of assignments) {
    console.log(`\n═══ @${a.authorHandle} → @${a.accountHandle} ═══`);
    const link = await prisma.inboundLink.findFirst({
      where: { authorHandle: a.authorHandle },
      orderBy: { receivedAt: 'desc' },
    });
    if (!link) { console.error('  ⚠️ link not found'); continue; }
    const account = await prisma.account.findFirst({ where: { handle: a.accountHandle } });
    if (!account) { console.error('  ⚠️ account not found'); continue; }

    console.log(`  media=${link.mediaUrls.length} · text=${link.rawText?.slice(0, 40)}...`);

    // 승격
    const promoted = await promoteInboundLink(link.id, 'manual');
    console.log(`  Promote: ${promoted.status}`);

    if (link.mediaUrls.length < 2) {
      console.error(`  ⚠️ media < 2 → Pipeline A skip`);
      continue;
    }

    // Pipeline A
    try {
      const outcome = await runPipelineA({
        accountId: account.id,
        sourceMediaUrls: link.mediaUrls,
        sourceText: link.rawText ?? '',
        sourceUrl: link.url,
        language: link.rawLanguage ?? undefined,
        explicitCommerceUrl: link.manualCommerceUrl ?? undefined,
      });
      if (link.manualCommerceUrl) console.log(`  💡 explicit commerce URL 사용: ${link.manualCommerceUrl}`);
      console.log(`  Pipeline A: ${outcome.status}`);
      if (outcome.status === 'PENDING_APPROVAL') {
        console.log(`    postId: ${outcome.postId}`);
        console.log(`    body: ${outcome.body}`);
      } else if (outcome.status === 'REJECTED') {
        console.log(`    stage: ${outcome.stage} · reason: ${outcome.reason}`);
      }
    } catch (err) {
      console.error(`  ❌ Pipeline A 실패: ${(err as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
