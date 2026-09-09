import { prisma } from '../../src/db/prisma.js';
import { researchTopic } from '../../src/modules/pipeline-d/research/index.js';
import { generateNaverPost } from '../../src/modules/pipeline-d/naver-copywriter/index.js';

async function main() {
  const posts = await prisma.naverPost.findMany({
    where: { kind: 'AFFILIATE', state: { in: ['DRAFT', 'PLANNED', 'READY'] } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`AFFILIATE 그라운딩 재생성 ${posts.length}건\n`);
  let ok = 0, fail = 0;
  for (const p of posts) {
    const angle = p.suggestedProduct ?? p.title ?? p.topic ?? '';
    try {
      const sourceNotes = await researchTopic(angle);
      const draft = await generateNaverPost({
        topic: p.title ?? angle,
        product: { name: p.suggestedProduct ?? p.title ?? angle, category: p.category ?? undefined },
        connectUrl: p.connectUrl ?? '',
        kind: 'AFFILIATE',
        category: p.category ?? undefined,
        sourceNotes,
        extraNote: '기존 상품을 자연스럽게 소개하되 정보 가치를 우선. 광고 티 최소화.',
      });
      await prisma.naverPost.update({ where: { id: p.id }, data: { title: draft.title, draftJson: draft as unknown as object } });
      ok++;
      console.log(`  ✓ ${sourceNotes ? '[근거]' : '[근거X]'} ${draft.title}`);
    } catch (e) {
      fail++;
      console.log(`  ✗ ${p.id}: ${(e as Error)?.message?.slice(0,90)}`);
    }
  }
  console.log(`\n완료: 성공 ${ok} / 실패 ${fail}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
