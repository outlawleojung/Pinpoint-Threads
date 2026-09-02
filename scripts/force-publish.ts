import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { publish } from '../src/modules/shared/publisher/index.js';

async function main() {
  const p = await prisma.post.findFirstOrThrow({
    where: { state: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, account: { select: { handle: true } } },
  });
  console.log(`Publishing ${p.id} @${p.account.handle} ...`);
  const r = await publish({ postId: p.id });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
