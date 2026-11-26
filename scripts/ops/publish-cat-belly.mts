import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { prisma } from '../../src/db/prisma.js';

// 계정 선택: 최근 일상글 간격이 제일 긴 계정 우선
const accounts = await prisma.account.findMany({
  where: { isActive: true },
  select: { id: true, handle: true },
  orderBy: { handle: 'asc' },
});

for (const acc of accounts) {
  const last = await prisma.post.findFirst({
    where: { accountId: acc.id, state: 'PUBLISHED' },
    orderBy: { publishedAt: 'desc' },
    select: { publishedAt: true, kind: true },
  });
  const ago = last?.publishedAt ? Math.round((Date.now() - last.publishedAt.getTime()) / 3600000) : 999;
  console.log(`${acc.handle}: 마지막 발행 ${ago}h 전 (${last?.kind ?? 'N/A'})`);
}

// sookck.kate나 minyoung.jung이 간격 넓을 듯 — 확인 후 선택
const target = accounts.find(a => a.handle === 'sookck.kate') 
  ?? accounts.find(a => a.handle === 'minyoung.jung')
  ?? accounts[0]!;

console.log(`\n→ 선택: ${target.handle}\n`);

const result = await runCustomPublish({
  accountId: target.id,
  sourceUrl: 'https://www.threads.com/@kore_mite.jp/post/DfGL3eUE9gz',
  direction: '고양이 뱃살 — 멍울인 줄 알고 걱정했는데 그냥 뱃살이었음. 고양이 특유의 뻔뻔한 표정 포인트.',
  hasVideo: true,
});

console.log('결과:', JSON.stringify(result, null, 2));
await prisma.$disconnect();
