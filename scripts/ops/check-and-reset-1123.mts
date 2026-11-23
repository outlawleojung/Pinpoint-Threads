import { prisma } from '../../src/db/prisma.js';

const today = new Date(); today.setHours(0, 0, 0, 0);

// 오늘 생성된 쇼핑 중 REJECTED 아닌 것 전부 폐기
const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', createdAt: { gte: today }, state: { not: 'REJECTED' } },
  include: { account: { select: { handle: true } } },
});
console.log(`오늘 쇼핑 (REJECTED 제외): ${posts.length}건`);
for (const p of posts) {
  console.log(`  ${p.state.padEnd(18)} @${p.account.handle.padEnd(16)} ${(p.generatedBody ?? '').replace(/\n/g, ' / ').slice(0, 60)}`);
}

if (posts.length > 0) {
  await prisma.post.updateMany({
    where: { id: { in: posts.map(p => p.id) } },
    data: { state: 'REJECTED' },
  });
  console.log(`\n🗑️ ${posts.length}건 → REJECTED`);
}

// inbound 17개 전부 FAILED 리셋
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

let resetCount = 0;
for (const rawUrl of urls) {
  const inbound = await prisma.inboundLink.findFirst({
    where: { OR: [{ url: rawUrl }, { normalizedUrl: rawUrl }] },
  });
  if (inbound) {
    if (inbound.status !== 'FAILED') {
      await prisma.inboundLink.update({ where: { id: inbound.id }, data: { status: 'FAILED' } });
      resetCount++;
    }
  } else {
    const shortId = rawUrl.split('/').pop()!;
    const found = await prisma.inboundLink.findFirst({ where: { url: { contains: shortId } } });
    if (found && found.status !== 'FAILED') {
      await prisma.inboundLink.update({ where: { id: found.id }, data: { status: 'FAILED' } });
      resetCount++;
    }
  }
}
console.log(`\n🔄 inbound ${resetCount}건 FAILED 리셋`);

await prisma.$disconnect();
