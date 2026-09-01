import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { classifyContentType } from '../src/modules/shared/content-classifier/index.js';

async function main() {
  const link = await prisma.inboundLink.findFirst({
    where: { normalizedUrl: { contains: 'canniioong0099' } },
  });
  if (!link) { console.log('not found'); process.exit(1); }
  console.log('URL:', link.url);
  console.log('저자:', link.authorHandle);
  console.log('본문:', link.rawText?.slice(0, 300));
  console.log('---');
  const result = await classifyContentType({
    text: link.rawText ?? '',
    mediaUrls: link.mediaUrls,
  });
  console.log('contentType:', result.contentType);
  console.log('reason:', result.reason);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
