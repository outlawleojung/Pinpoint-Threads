import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const id = process.argv[2] ?? 'cmti9e9hs0002qvjopyfn4ffd';
  const p = await prisma.post.findUnique({
    where: { id },
    select: {
      state: true,
      approvedAt: true,
      publishedAt: true,
      scheduledAt: true,
      threadsPostId: true,
      threadsReplyId: true,
      rejectionReason: true,
      account: { select: { handle: true } },
    },
  });
  console.log(JSON.stringify(p, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
