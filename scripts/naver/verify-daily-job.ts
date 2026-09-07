import { prisma } from '../../src/db/prisma.js';
import { runDailyInfoJob } from '../../src/modules/pipeline-d/daily-info-job/index.js';

async function main() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg || cfg.categories.length === 0) {
    console.error('SKIP: config 없음');
    process.exit(2);
  }
  const out = await runDailyInfoJob();
  console.log('daily info', out);
  const post = await prisma.naverPost.findUnique({ where: { id: out.naverPostId } });
  if (!post || post.kind !== 'INFO') throw new Error('일일 INFO 생성 실패');
  console.log('OK: daily info job (실측)');
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
