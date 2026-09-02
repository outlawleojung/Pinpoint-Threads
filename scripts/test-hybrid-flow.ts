import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { runPipelineA } from '../src/modules/pipeline-a/orchestrator.js';

const COUPANG_URL = 'https://www.coupang.com/vp/products/9212237294?itemId=26613824207&vendorItemId=95709246784&src=1139000&spec=10799999&addtag=400&ctag=9212237294&lptag=AF8111816&itime=20260902154511&pageType=PRODUCT&pageValue=9212237294&wPcid=17815901600689743133106&wRef=influencers.coupang.com&wTime=20260902154511&redirect=landing&traceid=V0-811-a4e862a696028b87&mcid=574c76337b6f4eb3a5acb2114c851c13&pt=&campaignid=&clickBeacon=&imgsize=&slot=&pageid=&sig=0300c97a0f&subid=&campaigntype=&puid=&ctime=1788331508&portal=CREATOR&landing_exp=&placementid=&puidType=&contentcategory=&tsource=&deviceid=&contenttype=&token=&impressionid=200001ec4b6f4d608a06198be05f9539&requestid=56c5f653dfff48579a4fe7f84b62b54b&contentkeyword=&offerId=&sfId=1008959&subparam=';

async function main() {
  // 1. @mon.i1l InboundLink 에 manualCommerceUrl 세팅
  const link = await prisma.inboundLink.findFirstOrThrow({
    where: { authorHandle: 'mon.i1l' },
    orderBy: { receivedAt: 'desc' },
  });
  await prisma.inboundLink.update({
    where: { id: link.id },
    data: { manualCommerceUrl: COUPANG_URL },
  });
  console.log(`✅ manualCommerceUrl 세팅: ${link.id}`);

  // 2. 기존 잘못 매칭된 Post REJECTED 처리
  const stale = await prisma.post.updateMany({
    where: {
      accountId: (await prisma.account.findFirstOrThrow({ where: { handle: 'sookck.kate' } })).id,
      state: { in: ['PENDING_APPROVAL'] },
      sourceItem: { rawText: { contains: '기대도 안 했는데' } },
    },
    data: { state: 'REJECTED', rejectionReason: '자동: 잘못된 브랜드 매칭 (아누아) → 하이브리드 재시도' },
  });
  console.log(`✅ 이전 잘못된 Post ${stale.count}건 REJECTED\n`);

  // 3. Pipeline A 재실행 (explicit URL 사용)
  const account = await prisma.account.findFirstOrThrow({ where: { handle: 'sookck.kate' } });
  console.log(`=== Pipeline A: @mon.i1l → @${account.handle} ===`);
  const outcome = await runPipelineA({
    accountId: account.id,
    sourceMediaUrls: link.mediaUrls,
    sourceText: link.rawText ?? '',
    sourceUrl: link.url,
    language: link.rawLanguage ?? undefined,
    explicitCommerceUrl: COUPANG_URL,
  });
  console.log(JSON.stringify(outcome, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
