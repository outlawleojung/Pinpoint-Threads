// 17개 쇼핑 소스 URL의 inbound 레코드를 FAILED로 리셋 → 재fetch 허용
import { prisma } from '../../src/db/prisma.js';

const urls = [
  'https://www.threads.com/@yellowcrispy/post/Df6fNdZG84z',
  'https://www.threads.com/@uche_myroom/post/Df6wQaXgdOR',
  'https://www.threads.com/@na.niiro/post/Df8gPTFkgvb',
  'https://www.threads.com/@hey_jian94/post/Df6dbSLmMFz',
  'https://www.threads.com/@whday.hmeal/post/Df7JgSsjwlq',
  'https://www.threads.com/share/Fgha0kc6d',
  'https://www.threads.com/@firstpenguin_is/post/Df4GqvgmaLK',
  'https://www.threads.com/@kirin_rin12/post/Df4Eb3_oF7K',
  'https://www.threads.com/@raku__ni__tanoshimu/post/Df0_VrUEWmJ',
  'https://www.threads.com/share/GTtLbuzwu',
  'https://www.threads.com/share/GF8fvDpew',
  'https://www.threads.com/share/LJbxsmcnm',
  'https://www.threads.com/share/DeEr1TXpf',
  'https://www.threads.com/share/EI7SbQerD',
  'https://www.threads.com/share/Bnd6l1_bf1',
  'https://www.threads.com/share/F_EkrVM1b',
  'https://www.threads.com/share/HXAXyHDiU',
];

// normalizedUrl 또는 url로 찾기
let resetCount = 0;
for (const rawUrl of urls) {
  const inbound = await prisma.inboundLink.findFirst({
    where: { OR: [{ url: rawUrl }, { normalizedUrl: rawUrl }] },
  });
  if (!inbound) {
    // share URL은 normalizedUrl이 다를 수 있음 — url LIKE 검색
    const shortId = rawUrl.split('/').pop()!;
    const found = await prisma.inboundLink.findFirst({
      where: { url: { contains: shortId } },
    });
    if (found) {
      await prisma.inboundLink.update({ where: { id: found.id }, data: { status: 'FAILED' } });
      console.log(`✅ FAILED 리셋: ${found.url.slice(0, 60)} (ID로 검색)`);
      resetCount++;
    } else {
      console.log(`⚠️ 못 찾음: ${rawUrl}`);
    }
  } else {
    await prisma.inboundLink.update({ where: { id: inbound.id }, data: { status: 'FAILED' } });
    console.log(`✅ FAILED 리셋: ${inbound.url.slice(0, 60)}`);
    resetCount++;
  }
}

// FAILED 된 포스트들도 정리 (방금 실패한 것들)
const failedPosts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'FAILED', createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
});
if (failedPosts.length > 0) {
  await prisma.post.updateMany({
    where: { id: { in: failedPosts.map(p => p.id) } },
    data: { state: 'REJECTED' },
  });
  console.log(`\n🗑️ 최근 10분 FAILED 포스트 ${failedPosts.length}건 → REJECTED`);
}

console.log(`\n${resetCount}/${urls.length}개 inbound 리셋 완료. 이제 배치 스크립트 재실행 가능.`);
await prisma.$disconnect();
