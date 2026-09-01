import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const link = await prisma.inboundLink.findFirst({
    where: { platform: 'THREADS' },
    orderBy: { receivedAt: 'desc' },
  });
  if (!link) {
    console.log('no inbound link found');
    process.exit(0);
  }
  console.log('=== InboundLink ===');
  console.log(JSON.stringify(link, null, 2));

  const bench = await prisma.benchmarkPost.findFirst({
    where: { inboundLinkId: link.id },
  });
  console.log('\n=== BenchmarkPost ===');
  if (bench) {
    const { embedding: _e, ...rest } = bench as Record<string, unknown>;
    console.log(JSON.stringify(rest, null, 2));
  } else {
    console.log('not found');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
