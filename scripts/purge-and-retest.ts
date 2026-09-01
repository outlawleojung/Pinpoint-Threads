import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { ingestUrl } from '../src/modules/shared/url-ingester/index.js';

const URL = process.argv[2] ?? 'https://www.threads.com/@yuji.ni1122/post/DcsmMV5kQ6N';

async function main() {
  // 이전 테스트 데이터 삭제
  const existing = await prisma.inboundLink.findUnique({
    where: { normalizedUrl: URL },
  });
  if (existing) {
    await prisma.benchmarkPost.deleteMany({ where: { inboundLinkId: existing.id } });
    await prisma.inboundLink.delete({ where: { id: existing.id } });
    console.log(`purged existing: ${existing.id}`);
  }

  console.log(`\n=== 재테스트: ${URL} ===\n`);
  const result = await ingestUrl({ url: URL, source: 'MANUAL_TELEGRAM' });
  console.log('결과:', JSON.stringify(result, null, 2));

  // DB 저장 결과 확인
  const link = await prisma.inboundLink.findUnique({ where: { normalizedUrl: URL } });
  const bench = link
    ? await prisma.benchmarkPost.findFirst({ where: { inboundLinkId: link.id } })
    : null;

  console.log('\n=== DB 확인 ===');
  console.log('mediaUrls:', link?.mediaUrls);
  console.log('engagement:', link?.engagement);
  console.log('publishedAt:', link?.publishedAt);
  if (bench) {
    console.log('bench.likesCount:', bench.likesCount);
    console.log('bench.repliesCount:', bench.repliesCount);
    console.log('bench.repostsCount:', bench.repostsCount);
    console.log('bench.mediaUrls:', bench.mediaUrls);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
