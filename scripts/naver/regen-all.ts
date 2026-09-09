import { prisma } from '../../src/db/prisma.js';
import { generateNaverPost } from '../../src/modules/pipeline-d/naver-copywriter/index.js';

// 발행대기 원고 전체를 새 방침(공감·문제해결 톤) 프롬프트로 재생성해 draftJson/title을 덮어쓴다.
// AFFILIATE의 sectionLinks는 재생성으로 사라짐(사용자 승인 완료 — 재생성 후 /naverlink 재부착).
async function main() {
  const posts = await prisma.naverPost.findMany({
    where: { state: { in: ['DRAFT', 'PLANNED', 'READY'] } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`재생성 대상 ${posts.length}건\n`);

  let ok = 0;
  let fail = 0;
  for (const p of posts) {
    const productName = p.suggestedProduct ?? p.category ?? p.topic ?? '추천 상품';
    const topic = p.title ?? p.topic ?? productName; // 기존 제목이 가장 구체적 → 주제 시드로
    try {
      const draft = await generateNaverPost({
        topic,
        product: { name: productName, category: p.category ?? undefined },
        connectUrl: p.connectUrl ?? 'https://example.com',
        kind: p.kind as 'INFO' | 'AFFILIATE',
      });
      await prisma.naverPost.update({
        where: { id: p.id },
        data: { title: draft.title, draftJson: draft as unknown as object },
      });
      ok += 1;
      console.log(`  ✓ [${p.kind}] ${draft.title}`);
    } catch (e) {
      fail += 1;
      console.log(`  ✗ ${p.id}: ${(e as Error)?.message?.slice(0, 100)}`);
    }
  }
  console.log(`\n완료: 성공 ${ok} / 실패 ${fail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
