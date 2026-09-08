import { buildInfoPost } from '../../src/modules/pipeline-d/info-post/index.js';
import { prisma } from '../../src/db/prisma.js';
import { env } from '../../src/config/env.js';

async function main() {
  const out = await buildInfoPost();
  const post = await prisma.naverPost.findUnique({ where: { id: out.naverPostId } });
  const draft = post?.draftJson as unknown as
    | { title?: string; intro?: string; sections?: { heading: string }[]; tags?: string[] }
    | null;
  console.log('=== 생성된 일상글 ===');
  console.log('카테고리:', out.category);
  console.log('제목:', out.title);
  console.log('도입:', draft?.intro?.slice(0, 160));
  console.log('소제목:', draft?.sections?.map((s) => s.heading));
  console.log('태그:', draft?.tags);
  console.log('연결가능 상품(선택 링크):', out.suggestedProduct ?? '(없음)');
  console.log('이미지 자리 수:', post?.imageUrls.length ?? 0, '(직접 삽입)');
  console.log('발행 페이지:', `http://localhost:${env.APP_PORT}/admin/naver/${out.naverPostId}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
