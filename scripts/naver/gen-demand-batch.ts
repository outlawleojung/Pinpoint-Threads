import { buildInfoPost } from '../../src/modules/pipeline-d/info-post/index.js';
import { NAVER_CATEGORIES } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

async function main() {
  const perCat = 2;
  let ok = 0, fail = 0;
  for (const cat of NAVER_CATEGORIES) {
    for (let i = 0; i < perCat; i++) {
      try {
        const out = await buildInfoPost({ category: cat });
        ok++;
        console.log(`  ✓ [${cat}] ${out.title}`);
      } catch (e) {
        fail++;
        console.log(`  ✗ [${cat}] ${(e as Error)?.message?.slice(0,90)}`);
      }
    }
  }
  console.log(`\n완료: 성공 ${ok} / 실패 ${fail}`);
}
main().catch(e=>{console.error(e);process.exit(1);});
