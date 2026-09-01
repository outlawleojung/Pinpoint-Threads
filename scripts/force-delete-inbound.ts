import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const pattern = process.argv[2];
  if (!pattern) {
    console.log('사용법: npx tsx scripts/force-delete-inbound.ts <URL 일부 문자열>');
    process.exit(1);
  }
  const links = await prisma.inboundLink.findMany({
    where: { normalizedUrl: { contains: pattern } },
  });
  if (links.length === 0) {
    console.log('no match for:', pattern);
    process.exit(0);
  }
  for (const link of links) {
    await prisma.benchmarkPost.deleteMany({ where: { inboundLinkId: link.id } });
    await prisma.inboundLink.delete({ where: { id: link.id } });
    console.log('deleted', link.id, link.normalizedUrl);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
