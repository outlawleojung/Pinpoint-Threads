import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const posts = await prisma.post.findMany({
    where: { kind: 'SHARING', state: 'PENDING_APPROVAL' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { account: { select: { handle: true } }, generatedBody: true, createdAt: true },
  });
  for (const p of posts) {
    console.log(`═══ @${p.account.handle} ═══`);
    console.log(p.generatedBody);
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
