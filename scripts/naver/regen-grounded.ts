import { prisma } from '../../src/db/prisma.js';
import { researchTopic } from '../../src/modules/pipeline-d/research/index.js';
import { generateNaverPost } from '../../src/modules/pipeline-d/naver-copywriter/index.js';

// 발행대기 INFO 글을 "웹 그라운딩" 방식으로 재생성. 주제(제목)는 유지, 본문만 근거 기반으로 다시 씀.
async function main() {
  const posts = await prisma.naverPost.findMany({
    where: { kind: 'INFO', state: { in: ['DRAFT', 'PLANNED', 'READY'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, topic: true, category: true },
  });
  console.log(`웹 그라운딩 재생성 대상 ${posts.length}건\n`);
  let ok = 0, fail = 0, grounded = 0;
  for (const p of posts) {
    const angle = p.title ?? p.topic ?? '';
    try {
      const sourceNotes = await researchTopic(angle);
      if (sourceNotes) grounded++;
      const draft = await generateNaverPost({
        topic: angle, product: { name: angle }, connectUrl: '', kind: 'INFO',
        category: p.category ?? undefined, sourceNotes,
      });
      await prisma.naverPost.update({ where: { id: p.id }, data: { title: draft.title, draftJson: draft as unknown as object } });
      ok++;
      console.log(`  ✓ ${sourceNotes ? '[근거]' : '[근거X]'} ${draft.title}`);
    } catch (e) {
      fail++;
      console.log(`  ✗ ${p.id}: ${(e as Error)?.message?.slice(0,90)}`);
    }
  }
  console.log(`\n완료: 성공 ${ok} / 실패 ${fail} (웹근거 확보 ${grounded}/${ok})`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
