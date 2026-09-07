import { prisma } from '../../src/db/prisma.js';
import { affiliateRatioExceeded, buildNaverPost } from '../../src/modules/pipeline-d/post-builder/index.js';

async function main() {
  const mode = process.argv[2]; // 'ratio' | 'full'
  await prisma.naverBlogConfig.upsert({
    where: { id: 'singleton' }, update: {}, create: { id: 'singleton', topic: '뷰티·생활템' },
  }).catch(async () => {
    const existing = await prisma.naverBlogConfig.findFirst();
    if (!existing) await prisma.naverBlogConfig.create({ data: { topic: '뷰티·생활템' } });
  });

  if (mode === 'ratio') {
    const r = await affiliateRatioExceeded();
    console.log('ratio result', r);
    console.log('OK: ratio check');
    return;
  }

  const link = process.argv[3];
  if (!link) { console.error('사용법: verify-builder.ts full <쇼핑커넥트 링크>'); process.exit(2); }
  const out = await buildNaverPost({ connectUrl: link, kind: 'AFFILIATE' });
  console.log('built', out);
  const post = await prisma.naverPost.findUnique({ where: { id: out.naverPostId } });
  if (!post || post.state !== 'PLANNED') throw new Error('NaverPost PLANNED 저장 실패');
  console.log('OK: builder full (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
