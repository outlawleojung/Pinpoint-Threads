import { prisma } from '../../src/db/prisma.js';
import { NAVER_CATEGORIES, normalizeNaverCategory } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

// 1) 블로그 config 카테고리를 깜냥로그 표준 5개로 교체. 2) 기존 글 category 백필(제목 기반 정규화).
async function main() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (cfg) {
    await prisma.naverBlogConfig.update({
      where: { id: cfg.id },
      data: { categories: [...NAVER_CATEGORIES], topic: '자취·원룸 리빙' },
    });
    console.log('config 카테고리 →', NAVER_CATEGORIES.join(' / '));
  } else {
    console.log('NaverBlogConfig 없음 — 스킵');
  }

  const posts = await prisma.naverPost.findMany({ select: { id: true, title: true, topic: true, category: true } });
  let changed = 0;
  for (const p of posts) {
    // 옛 taxonomy를 새것으로 교체하므로 제목(내용) 기준으로 재분류.
    const next = normalizeNaverCategory(p.title ?? p.topic ?? p.category);
    if (next !== p.category) {
      await prisma.naverPost.update({ where: { id: p.id }, data: { category: next } });
      changed += 1;
      console.log(`  ${p.title ?? p.id}\n    → ${next}`);
    }
  }
  console.log(`\n백필 완료: ${changed}/${posts.length}건 갱신`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
