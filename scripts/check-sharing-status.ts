import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const posts = await prisma.post.findMany({
    where: { kind: 'SHARING' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      account: { select: { handle: true } },
      state: true,
      threadsPostId: true,
      scheduledAt: true,
      publishedAt: true,
    },
  });
  console.table(posts.map((p) => ({
    handle: p.account.handle,
    state: p.state,
    threadsPostId: p.threadsPostId,
    scheduled: p.scheduledAt?.toISOString(),
    published: p.publishedAt?.toISOString(),
  })));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
