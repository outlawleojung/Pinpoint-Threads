import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const posts = await prisma.post.findMany({
    where: { kind: 'SHOPPING' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true, state: true, threadsPostId: true, threadsReplyId: true,
      createdAt: true, publishedAt: true,
      account: { select: { handle: true } },
    },
  });
  console.table(posts.map((p) => ({
    id: p.id,
    handle: p.account.handle,
    state: p.state,
    threadsPostId: p.threadsPostId,
    threadsReplyId: p.threadsReplyId,
    createdAt: p.createdAt.toISOString(),
    publishedAt: p.publishedAt?.toISOString(),
  })));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
