// 크레딧 소진으로 실패한 쇼핑 3건 재처리
import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const items: { url: string; link: string }[] = [
  { url: 'https://www.threads.com/share/Bnd6l1_bf1', link: 'https://link.coupang.com/a/iKPioDMdcy' },
  { url: 'https://www.threads.com/share/F_EkrVM1b', link: 'https://link.coupang.com/a/iKPwnrk4Lk' },
  { url: 'https://www.threads.com/share/HXAXyHDiU', link: 'https://link.coupang.com/a/iKPCXPh4oe' },
];

const MALE_KEYWORDS = ['남성', '남자', '남친', '남편', '면도', '그루밍', '남성용', '보디빌딩', '수염'];
const FEMALE_HANDLES = ['pikkseetem', 'hanseoa.pick', 'kle0_lee'];
const MALE_HANDLE = 'minyoung.jung';
const BASE_DIRECTION = '원작자가 왜 이걸 샀는지, 쓰고 나서 뭐가 달라졌는지 — 그 "아 이거 진짜 괜찮네" 순간을 1인칭으로. 상품명·스펙·색감 나열 금지. 광고 아닌 솔직한 후기처럼.';

const allHandles = [MALE_HANDLE, ...FEMALE_HANDLES];
const accountMap: Record<string, string> = {};
for (const h of allHandles) {
  const acc = await prisma.account.findFirstOrThrow({ where: { handle: h } });
  accountMap[h] = acc.id;
}

// 오늘 배분 상황 조회 — 균형 맞추기 위해
const now = new Date(); now.setHours(0, 0, 0, 0);
const existingCount: Record<string, number> = {};
for (const h of FEMALE_HANDLES) existingCount[h] = 0;
const existing = await prisma.post.findMany({
  where: { kind: 'SHOPPING', createdAt: { gte: now }, state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  include: { account: { select: { handle: true } } },
});
for (const p of existing) {
  if (FEMALE_HANDLES.includes(p.account.handle)) {
    existingCount[p.account.handle] = (existingCount[p.account.handle] ?? 0) + 1;
  }
}
console.log('현재 배분:', existingCount);

function isMale(text: string): boolean {
  const d = text.toLowerCase();
  return MALE_KEYWORDS.some(k => d.includes(k.toLowerCase()));
}

function pickLeastLoadedFemale(): string {
  let minCount = Infinity;
  let picked = FEMALE_HANDLES[0]!;
  for (const h of FEMALE_HANDLES) {
    if ((existingCount[h] ?? 0) < minCount) {
      minCount = existingCount[h] ?? 0;
      picked = h;
    }
  }
  return picked;
}

for (let i = 0; i < items.length; i++) {
  const item = items[i]!;
  const tempAccId = accountMap['pikkseetem']!;

  console.log(`\n🛍️ [${i + 1}/${items.length}] ${item.url.split('/').pop()?.slice(0, 20)}`);
  try {
    const r = await runCustomPublish({
      accountId: tempAccId,
      sourceUrl: item.url,
      commerceUrl: item.link,
      holdApproval: true,
      direction: BASE_DIRECTION,
    });
    if (r.status === 'PENDING_APPROVAL') {
      const inbound = await prisma.inboundLink.findFirst({
        where: { OR: [{ url: item.url }, { normalizedUrl: item.url }] },
        select: { rawText: true },
      });
      const combinedText = [inbound?.rawText ?? '', r.body].join(' ');
      const targetHandle = isMale(combinedText) ? MALE_HANDLE : pickLeastLoadedFemale();

      if (targetHandle !== 'pikkseetem') {
        await prisma.post.update({ where: { id: r.postId }, data: { accountId: accountMap[targetHandle]! } });
      }
      existingCount[targetHandle] = (existingCount[targetHandle] ?? 0) + 1;

      await sendApprovalRequest(r.postId);
      console.log(`  ✅ @${targetHandle} | ${r.body.replace(/\n/g, ' / ').slice(0, 80)}`);
    } else {
      console.log(`  ❌ ${r.stage} | ${r.reason}`);
    }
  } catch (err: any) {
    console.error(`  ❌ 실패:`, err.message?.slice(0, 100));
  }
}

console.log('\n최종 배분:', existingCount);

await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
