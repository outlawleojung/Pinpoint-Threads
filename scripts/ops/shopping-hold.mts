// 쇼핑 소재 보관: '[["소스URL","상품 설명","쿠팡 파트너스 링크"], ...]' → 링크 계정(기본 pikkseetem)에 카드 보류로 저장
import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';
const items = JSON.parse(process.argv[2]!) as [string, string, string][];
const handle = process.argv[3] ?? 'pikkseetem';
const acc = await prisma.account.findFirstOrThrow({ where: { handle } });
for (const [url, desc, link] of items) {
  const r = await runCustomPublish({
    accountId: acc.id, sourceUrl: url, commerceUrl: link, holdApproval: true,
    direction: `${desc} — 하입/FOMO 쇼핑 카피, 원작자 정황 재연 X, 반응·구매욕 1인칭만`,
  });
  console.log(r.status === 'PENDING_APPROVAL' ? `SHOP ${r.postId} | ${r.body.replace(/\n/g, ' / ').slice(0, 120)}` : `FAIL ${url} ${r.stage} ${r.reason}`);
}
await shutdownPlaywrightBrowser(); await prisma.$disconnect(); process.exit(0);
