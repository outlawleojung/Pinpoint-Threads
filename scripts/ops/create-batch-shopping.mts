import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const COPY_RULE = `
★ 금지: 모델명 금지, 외형 묘사 금지 (색감·소재·디자인), 뻔한 광고 패턴 금지 ("사고쳤네/일냈네" 등), 원작자 정황 재연 금지
★ 허용·필수: 브랜드명 OK, 장점·특징 OK (편하다, 가볍다 — 사진으로 안 보이는 것), 광고 아닌 척 광고, 쓰레드 말투 (반말, ㅋㅋ, ;;)
`.trim();

const items: { threadId: string; commerceUrl: string; label: string; hint: string }[] = [
  {
    threadId: 'BASvX3q6cH',
    commerceUrl: 'https://link.coupang.com/a/ivYOEvZKI8',
    label: '뉴발 로퍼',
    hint: '뉴발란스 클래식 로퍼 — 운동화 에어가 박혀서 편함',
  },
  {
    threadId: 'BAWDXfeOif',
    commerceUrl: 'https://link.coupang.com/a/ivY3HD04MC',
    label: '나이키 브루클린',
    hint: '나이키 브루클린 우먼스 부츠 — 색감 예쁨, 5년만에 새신발',
  },
  {
    threadId: 'BATh_T4XjG',
    commerceUrl: 'https://link.coupang.com/a/ivYRO9TmJU',
    label: '나이키 에어 로퍼',
    hint: '나이키 에어 로퍼 — 로퍼에 에어를 넣은 착화감, 에어맥스급 편안함',
  },
  {
    threadId: '_qSi3pBY2',
    commerceUrl: 'https://link.coupang.com/a/ivY1OEzW9I',
    label: '아식스 젤카야노',
    hint: '아식스 — 발바닥 편한 러닝화, 추천받아서 삼',
  },
];

const handles = ['pikkseetem', 'sookck.kate'];

for (const item of items) {
  // find source URL from inbound
  const inbound = await prisma.inboundLink.findFirst({
    where: { url: { contains: item.threadId } },
    select: { url: true },
  });
  if (!inbound) {
    console.log(`⚠️ ${item.label}: 인바운드 못 찾음 (${item.threadId})`);
    continue;
  }

  for (const handle of handles) {
    const acc = await prisma.account.findFirstOrThrow({ where: { handle } });
    try {
      const r = await runCustomPublish({
        accountId: acc.id,
        sourceUrl: inbound.url,
        commerceUrl: item.commerceUrl,
        holdApproval: true,
        direction: `${item.hint}\n${COPY_RULE}`,
      });
      if (r.status === 'PENDING_APPROVAL') {
        console.log(`✅ ${handle} ${item.label}: ${r.body.replace(/\n/g, ' / ').slice(0, 120)}`);
        await sendApprovalRequest(r.postId);
        console.log(`📨 카드: ${r.postId.slice(-8)}`);
      } else {
        console.log(`❌ ${handle} ${item.label}: ${r.stage} — ${r.reason}`);
      }
    } catch (err) {
      console.log(`❌ ${handle} ${item.label}: ${(err as Error).message.slice(0, 150)}`);
    }
  }
}

console.log('\n✅ 완료.');
await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
