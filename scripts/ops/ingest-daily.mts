import { prisma } from '../../src/db/prisma.js';
import { ingestUrl } from '../../src/modules/shared/url-ingester/index.js';

const url = 'https://www.threads.com/@kore_mite.jp/post/DfGL3eUE9gz';

console.log('인제스트 시작...');
const result = await ingestUrl({ url, source: 'MANUAL_TELEGRAM', skipPromote: true });
console.log('인제스트 결과:', JSON.stringify(result, null, 2));

if (result.inboundLinkId) {
  const inbound = await prisma.inboundLink.findUnique({
    where: { id: result.inboundLinkId },
    select: { rawText: true, rawLanguage: true, mediaUrls: true, url: true },
  });
  console.log('\n원문:', inbound?.rawText?.slice(0, 200));
  console.log('언어:', inbound?.rawLanguage);
  console.log('미디어:', inbound?.mediaUrls?.length, '개');
  console.log('미디어 URL:', inbound?.mediaUrls);
}

await prisma.$disconnect();
