// 2026-11-21 쇼핑 9건 — 성별 자동 라우팅 + holdApproval
import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const items: { url: string; link: string }[] = [
  { url: 'https://www.threads.com/@yellowcrispy/post/Df6fNdZG84z', link: 'https://link.coupang.com/a/iRjDaHnRXo' },
  { url: 'https://www.threads.com/@uche_myroom/post/Df6wQaXgdOR', link: 'https://link.coupang.com/a/iRjK4zj5UW' },
  { url: 'https://www.threads.com/@na.niiro/post/Df8gPTFkgvb', link: 'https://link.coupang.com/a/iRjPd9rP4K' },
  { url: 'https://www.threads.com/@hey_jian94/post/Df6dbSLmMFz', link: 'https://www.musinsa.com/curator/goods/L8ssSinM' },
  { url: 'https://www.threads.com/@whday.hmeal/post/Df7JgSsjwlq', link: 'https://link.coupang.com/a/iRkgLQQ6ma' },
  { url: 'https://www.threads.com/share/Fgha0kc6d', link: 'https://link.coupang.com/a/iRkDZ4oD0e' },
  { url: 'https://www.threads.com/@firstpenguin_is/post/Df4GqvgmaLK', link: 'https://link.coupang.com/a/iRkHa3rIv6' },
  { url: 'https://www.threads.com/@kirin_rin12/post/Df4Eb3_oF7K', link: 'https://link.coupang.com/a/iRkML9a0Jg' },
  { url: 'https://www.threads.com/@raku__ni__tanoshimu/post/Df0_VrUEWmJ', link: 'https://link.coupang.com/a/iRk2DGF1jw' },
];

// 성별 판단은 generatedBody 기반 — 카피 생성 후 라우팅
const MALE_KEYWORDS = ['남성', '남자', '운동화', '스니커즈', '러닝화', '에어포스', '에어맥스', '덩크', '조던', '뉴발란스', '아식스', '젤카야노', '나이키', '면도', '그루밍', '남친'];
const FEMALE_KEYWORDS = ['여성', '여자', '부츠', '하이탑', '뮬', '로퍼', '플랫', '슬링백', '힐', '샌들', '원피스', '블라우스', '스커트', '화장', '립', '쿠션', '파데', '여친'];

function pickHandle(text: string): string {
  const d = text.toLowerCase();
  if (FEMALE_KEYWORDS.some(k => d.includes(k.toLowerCase()))) return 'pikkseetem';
  if (MALE_KEYWORDS.some(k => d.includes(k.toLowerCase()))) return 'minyoung.jung';
  return 'pikkseetem'; // 기본값
}

const BASE_DIRECTION = '원작자가 왜 이걸 샀는지, 쓰고 나서 뭐가 달라졌는지 — 그 "아 이거 진짜 괜찮네" 순간을 1인칭으로. 상품명·스펙·색감 나열 금지. 광고 아닌 솔직한 후기처럼.';

const results: { url: string; handle: string; body: string; postId: string }[] = [];

for (let i = 0; i < items.length; i++) {
  const item = items[i]!;
  // 1차: pikkseetem으로 카피 생성 (holdApproval)
  const tempAcc = await prisma.account.findFirstOrThrow({ where: { handle: 'pikkseetem' } });

  console.log(`\n🛍️ [${i + 1}/${items.length}] ${item.url.split('/').pop()?.slice(0, 20)}`);
  try {
    const r = await runCustomPublish({
      accountId: tempAcc.id,
      sourceUrl: item.url,
      commerceUrl: item.link,
      holdApproval: true,
      direction: BASE_DIRECTION,
    });
    if (r.status === 'PENDING_APPROVAL') {
      // 카피 기반 성별 판단
      const targetHandle = pickHandle(r.body);
      if (targetHandle !== 'pikkseetem') {
        // 다른 계정으로 재배정
        const targetAcc = await prisma.account.findFirstOrThrow({ where: { handle: targetHandle } });
        await prisma.post.update({ where: { id: r.postId }, data: { accountId: targetAcc.id } });
        console.log(`  → 재배정: pikkseetem → ${targetHandle}`);
      }
      await sendApprovalRequest(r.postId);
      const finalHandle = targetHandle;
      console.log(`  ✅ @${finalHandle} | ${r.body.replace(/\n/g, ' / ').slice(0, 80)}`);
      results.push({ url: item.url, handle: finalHandle, body: r.body, postId: r.postId });
    } else {
      console.log(`  ❌ ${r.stage} | ${r.reason}`);
    }
  } catch (err: any) {
    console.error(`  ❌ 실패:`, err.message?.slice(0, 100));
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`✅ 완료: ${results.length}/${items.length}건`);
for (const r of results) {
  console.log(`  @${r.handle.padEnd(16)} ${r.body.replace(/\n/g, ' / ').slice(0, 70)}`);
}

await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
