import { prisma } from '../../src/db/prisma.js';
import { buildInfoPost } from '../../src/modules/pipeline-d/info-post/index.js';

const RISKY = ['사러 가기 좋은 동네', '홍대 빈티지', '정리수납 업체', '정리수납전문가 자격증', '과태료', '무료수거 신청'];

async function main() {
  // 1) 위험한 6편 삭제
  const del = await prisma.naverPost.deleteMany({ where: { OR: RISKY.map((t) => ({ title: { contains: t } })) } });
  console.log(`삭제: ${del.count}건\n`);

  // 2) 영향 카테고리에 안전한 실수요 주제로 2편씩 재생성
  const cats = ['레트로·뉴트로 주방', '정리수납·살림팁', '리빙템·가전 리뷰'];
  let ok = 0, fail = 0;
  for (const cat of cats) {
    for (let i = 0; i < 2; i++) {
      try {
        const out = await buildInfoPost({ category: cat });
        ok++; console.log(`  ✓ [${cat}] ${out.title}`);
      } catch (e) { fail++; console.log(`  ✗ [${cat}] ${(e as Error)?.message?.slice(0,90)}`); }
    }
  }
  console.log(`\n재생성 완료: 성공 ${ok} / 실패 ${fail}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
