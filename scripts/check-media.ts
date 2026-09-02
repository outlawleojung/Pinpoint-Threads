import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const links = await prisma.inboundLink.findMany({
    where: { authorHandle: 'mon.i1l' },
    orderBy: { receivedAt: 'desc' },
  });
  for (const link of links) {
    console.log(`━━━ ${link.receivedAt.toISOString()} · id=${link.id}`);
    console.log(`URL: ${link.url}`);
    console.log(`mediaUrls (${link.mediaUrls.length}):`);
    console.log(JSON.stringify(link.mediaUrls, null, 2));
    console.log();
  }
  // Post 에 저장된 media 도
  const post = await prisma.post.findFirst({
    where: { generatedBody: { contains: '기대 안 했는데' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, mediaUrls: true, sourceMediaUrls: true, generatedBody: true },
  });
  if (post) {
    console.log(`━━━ Post ${post.id}`);
    console.log(`sourceMediaUrls (${post.sourceMediaUrls.length}):`);
    console.log(JSON.stringify(post.sourceMediaUrls, null, 2));
    console.log(`mediaUrls Cloudinary (${post.mediaUrls.length}):`);
    console.log(JSON.stringify(post.mediaUrls, null, 2));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
