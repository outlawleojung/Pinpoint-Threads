// 2026-11-23 쇼핑 17건 — 성별 라우팅 + 전 계정 분배 + holdApproval
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

// 명백한 남성 전용 키워드만 (운동화·스니커즈·브랜드명은 유니섹스라 제외)
const MALE_KEYWORDS = ['남성', '남자', '남친', '남편', '면도', '그루밍', '남성용', '보디빌딩', '수염'];

const FEMALE_HANDLES = ['pikkseetem', 'hanseoa.pick', 'kle0_lee'];
const MALE_HANDLE = 'minyoung.jung';

const BASE_DIRECTION = '원작자가 왜 이걸 샀는지, 쓰고 나서 뭐가 달라졌는지 — 그 "아 이거 진짜 괜찮네" 순간을 1인칭으로. 상품명·스펙·색감 나열 금지. 광고 아닌 솔직한 후기처럼.';

// 계정 로드
const allHandles = [MALE_HANDLE, ...FEMALE_HANDLES];
const accountMap: Record<string, string> = {};
for (const h of allHandles) {
  const acc = await prisma.account.findFirstOrThrow({ where: { handle: h } });
  accountMap[h] = acc.id;
}

// 성별 판단 (소스 텍스트 기반) — 남성향이면 minyoung.jung, 나머지는 여성 3계정 라운드 로빈
function isMale(text: string): boolean {
  const d = text.toLowerCase();
  return MALE_KEYWORDS.some(k => d.includes(k.toLowerCase()));
}

let femaleIdx = 0;
function pickHandle(sourceText: string): string {
  if (isMale(sourceText)) return MALE_HANDLE;
  const h = FEMALE_HANDLES[femaleIdx % FEMALE_HANDLES.length]!;
  femaleIdx++;
  return h;
}

const results: { url: string; handle: string; body: string; postId: string }[] = [];

for (let i = 0; i < items.length; i++) {
  const item = items[i]!;
  // 먼저 pikkseetem으로 생성 (카피 생성 후 소스 텍스트로 성별 판단해서 재배정)
  const tempAccId = accountMap['pikkseetem']!;

  console.log(`\n🛍️ [${i + 1}/${items.length}] ${item.url.split('/').pop()?.slice(0, 20)}`);
  try {
    const r = await runCustomPublish({
      accountId: tempAccId,
      sourceUrl: item.url,
      commerceUrl: item.link,
      holdApproval: true,
      direction: item.note || BASE_DIRECTION,
    });
    if (r.status === 'PENDING_APPROVAL') {
      // 소스 원문 + 카피 본문 + note 종합해서 성별 판단
      const inbound = await prisma.inboundLink.findFirst({
        where: { OR: [{ url: item.url }, { normalizedUrl: item.url }] },
        select: { rawText: true },
      });
      const combinedText = [item.note ?? '', inbound?.rawText ?? '', r.body].join(' ');
      const targetHandle = pickHandle(combinedText);

      if (targetHandle !== 'pikkseetem') {
        await prisma.post.update({ where: { id: r.postId }, data: { accountId: accountMap[targetHandle]! } });
      }

      await sendApprovalRequest(r.postId);
      console.log(`  ✅ @${targetHandle} | ${r.body.replace(/\n/g, ' / ').slice(0, 80)}`);
      results.push({ url: item.url, handle: targetHandle, body: r.body, postId: r.postId });
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
