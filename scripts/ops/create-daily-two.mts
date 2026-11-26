import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const urls = [
  'https://www.threads.com/share/BBh6BWsXXe',
  'https://www.threads.com/share/_pWIYCnxr',
];

// 오늘 일상글이 가장 적은 계정 2개에 배정
const today = new Date();
today.setHours(0, 0, 0, 0);

const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true },
});

// 계정별 오늘 DAILY 수
const counts = await Promise.all(
  accounts.map(async (a) => ({
    ...a,
    dailyCount: await prisma.post.count({
      where: { accountId: a.id, kind: 'DAILY', createdAt: { gte: today }, state: { notIn: ['REJECTED', 'FAILED'] } },
    }),
  })),
);
counts.sort((a, b) => a.dailyCount - b.dailyCount);

for (let i = 0; i < urls.length; i++) {
  const acc = counts[i % counts.length]!;
  const url = urls[i]!;
  console.log(`\n🌿 [${i + 1}/${urls.length}] ${acc.handle} ← ${url}`);
  try {
    const r = await runCustomPublish({
      accountId: acc.id,
      sourceUrl: url,
      holdApproval: true,
      direction: '일상글 — 동물/일상 소재, 반응 한마디, 장면 설명 금지, 감정·리액션만',
    });
    if (r.status === 'PENDING_APPROVAL') {
      await sendApprovalRequest(r.postId);
      console.log(`✅ ${acc.handle} | 카드 발송 완료 | ${r.body.replace(/\n/g, ' / ').slice(0, 80)}`);
    } else {
      console.log(`❌ ${acc.handle} | ${r.stage} | ${r.reason}`);
    }
  } catch (err: any) {
    console.error(`❌ ${acc.handle} 실패:`, err.message);
  }
}

await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
