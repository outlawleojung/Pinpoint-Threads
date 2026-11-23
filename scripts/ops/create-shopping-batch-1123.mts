// 2026-11-23 쇼핑 17건 — 4계정 라운드 로빈 분배 + holdApproval
import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const items: { url: string; link: string; note?: string }[] = [
  { url: 'https://www.threads.com/@yellowcrispy/post/Df6fNdZG84z', link: 'https://link.coupang.com/a/iRjDaHnRXo' },
  { url: 'https://www.threads.com/@uche_myroom/post/Df6wQaXgdOR', link: 'https://link.coupang.com/a/iRjK4zj5UW' },
  { url: 'https://www.threads.com/@na.niiro/post/Df8gPTFkgvb', link: 'https://link.coupang.com/a/iRjPd9rP4K' },
  { url: 'https://www.threads.com/@hey_jian94/post/Df6dbSLmMFz', link: 'https://www.musinsa.com/curator/goods/L8ssSinM' },
  { url: 'https://www.threads.com/@whday.hmeal/post/Df7JgSsjwlq', link: 'https://link.coupang.com/a/iRkgLQQ6ma' },
  { url: 'https://www.threads.com/share/Fgha0kc6d', link: 'https://link.coupang.com/a/iRkDZ4oD0e' },
  { url: 'https://www.threads.com/@firstpenguin_is/post/Df4GqvgmaLK', link: 'https://link.coupang.com/a/iRkHa3rIv6' },
  { url: 'https://www.threads.com/@kirin_rin12/post/Df4Eb3_oF7K', link: 'https://link.coupang.com/a/iRkML9a0Jg' },
  { url: 'https://www.threads.com/@raku__ni__tanoshimu/post/Df0_VrUEWmJ', link: 'https://link.coupang.com/a/iRk2DGF1jw' },
  { url: 'https://www.threads.com/share/GTtLbuzwu', link: 'https://www.musinsa.com/curator/goods/mCFlpDFP' },
  { url: 'https://www.threads.com/share/GF8fvDpew', link: 'https://www.musinsa.com/curator/goods/bZDSS8rx' },
  { url: 'https://www.threads.com/share/LJbxsmcnm', link: 'https://link.coupang.com/a/iKO18Xn24W' },
  { url: 'https://www.threads.com/share/DeEr1TXpf', link: 'https://link.coupang.com/a/iKO7N7FFdY', note: '그냥 로퍼에 빨간 양말이 어울린다는 컨셉' },
  { url: 'https://www.threads.com/share/EI7SbQerD', link: 'https://link.coupang.com/a/iKPcvXizsq' },
  { url: 'https://www.threads.com/share/Bnd6l1_bf1', link: 'https://link.coupang.com/a/iKPioDMdcy' },
  { url: 'https://www.threads.com/share/F_EkrVM1b', link: 'https://link.coupang.com/a/iKPwnrk4Lk' },
  { url: 'https://www.threads.com/share/HXAXyHDiU', link: 'https://link.coupang.com/a/iKPCXPh4oe' },
];

// 4계정 라운드 로빈 (sookck.kate 제외 — 정지 상태)
const HANDLES = ['pikkseetem', 'minyoung.jung', 'hanseoa.pick', 'kle0_lee'];

const BASE_DIRECTION = '원작자가 왜 이걸 샀는지, 쓰고 나서 뭐가 달라졌는지 — 그 "아 이거 진짜 괜찮네" 순간을 1인칭으로. 상품명·스펙·색감 나열 금지. 광고 아닌 솔직한 후기처럼.';

// 계정 ID 미리 로드
const accounts = await Promise.all(
  HANDLES.map(h => prisma.account.findFirstOrThrow({ where: { handle: h } })),
);

const results: { url: string; handle: string; body: string; postId: string }[] = [];

for (let i = 0; i < items.length; i++) {
  const item = items[i]!;
  const account = accounts[i % HANDLES.length]!;
  const handle = HANDLES[i % HANDLES.length]!;

  console.log(`\n🛍️ [${i + 1}/${items.length}] @${handle} ← ${item.url.split('/').pop()?.slice(0, 20)}`);
  try {
    const r = await runCustomPublish({
      accountId: account.id,
      sourceUrl: item.url,
      commerceUrl: item.link,
      holdApproval: true,
      direction: item.note || BASE_DIRECTION,
    });
    if (r.status === 'PENDING_APPROVAL') {
      await sendApprovalRequest(r.postId);
      console.log(`  ✅ @${handle} | ${r.body.replace(/\n/g, ' / ').slice(0, 80)}`);
      results.push({ url: item.url, handle, body: r.body, postId: r.postId });
    } else {
      console.log(`  ❌ ${r.stage} | ${r.reason}`);
    }
  } catch (err: any) {
    console.error(`  ❌ 실패:`, err.message?.slice(0, 100));
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`✅ 완료: ${results.length}/${items.length}건`);
const summary: Record<string, number> = {};
for (const r of results) {
  summary[r.handle] = (summary[r.handle] ?? 0) + 1;
  console.log(`  @${r.handle.padEnd(16)} ${r.body.replace(/\n/g, ' / ').slice(0, 70)}`);
}
console.log('\n계정별 배분:', summary);

await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
