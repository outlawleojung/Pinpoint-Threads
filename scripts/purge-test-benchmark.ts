import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

const URL = process.argv[2] ?? 'https://www.threads.com/@yuji.ni1122/post/DcsmMV5kQ6N';

async function main() {
  const link = await prisma.inboundLink.findUnique({ where: { normalizedUrl: URL } });
  if (!link) {
    console.log('no link found');
    process.exit(0);
  }
  const benchmarks = await prisma.benchmarkPost.findMany({ where: { inboundLinkId: link.id } });
  for (const b of benchmarks) {
    await prisma.benchmarkPost.delete({ where: { id: b.id } });
    console.log(`deleted benchmark ${b.id}`);
  }
  await prisma.inboundLink.delete({ where: { id: link.id } });
  console.log(`deleted inbound ${link.id}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
