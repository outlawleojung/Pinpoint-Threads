import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { ingestUrl } from '../src/modules/shared/url-ingester/index.js';
import { InboundSource } from '@prisma/client';
import { runPipelineA } from '../src/modules/pipeline-a/orchestrator.js';
import { shutdownPlaywrightBrowser } from '../src/infra/playwright-threads-video.js';

const URL = 'https://www.threads.com/@mon.i1l/post/DctUf-9Gt2N?hl=ko';
const COUPANG_URL = 'https://www.coupang.com/vp/products/9212237294?itemId=26613824207&vendorItemId=95709246784';

async function main() {
  // 1) 기존 InboundLink 삭제 (재fetch)
  await prisma.inboundLink.deleteMany({ where: { authorHandle: 'mon.i1l' } });
  console.log('✅ 기존 mon.i1l InboundLink 삭제\n');

  // 2) 재ingest (Playwright 로 mp4 URL 채워짐)
  const r = await ingestUrl({
    url: URL,
    source: InboundSource.MANUAL_TELEGRAM,
    manualCommerceUrl: COUPANG_URL,
  });
  console.log(`✅ Ingested: ${r.inboundLinkId} · ${r.status}`);

  const link = await prisma.inboundLink.findUniqueOrThrow({ where: { id: r.inboundLinkId } });
  console.log(`   mediaUrls (${link.mediaUrls.length}):`);
  link.mediaUrls.forEach((u, i) => {
    const kind = u.includes('.mp4') || u.includes('/video/upload/') ? '🎬 VIDEO' : '🖼️ IMAGE';
    console.log(`     [${i}] ${kind} · ${u.slice(0, 120)}...`);
  });

  // 3) Pipeline A 실행
  const account = await prisma.account.findFirstOrThrow({ where: { handle: 'sookck.kate' } });
  console.log(`\n=== Pipeline A: ${link.id} → @${account.handle} ===`);
  const outcome = await runPipelineA({
    accountId: account.id,
    sourceMediaUrls: link.mediaUrls,
    sourceText: link.rawText ?? '',
    sourceUrl: link.url,
    language: link.rawLanguage ?? undefined,
    explicitCommerceUrl: COUPANG_URL,
  });
  console.log(JSON.stringify(outcome, null, 2));

  await shutdownPlaywrightBrowser();
  process.exit(0);
}
main().catch(async (e) => {
  console.error(e);
  await shutdownPlaywrightBrowser().catch(() => {});
  process.exit(1);
});
