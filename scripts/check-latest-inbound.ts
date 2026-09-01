import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const links = await prisma.inboundLink.findMany({
    orderBy: { receivedAt: 'desc' },
    take: 5,
    select: {
      id: true, url: true, authorHandle: true, status: true,
      engagement: true, receivedAt: true, errorMessage: true,
    },
  });
  for (const l of links) {
    console.log(`${l.receivedAt.toISOString()} · @${l.authorHandle ?? '?'} · ${l.status}`);
    console.log(`  ${l.url}`);
    console.log(`  engagement: ${JSON.stringify(l.engagement)}`);
    if (l.errorMessage) console.log(`  err: ${l.errorMessage}`);
    console.log('');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
