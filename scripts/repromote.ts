import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { promoteInboundLink } from '../src/modules/shared/source-collector/promoter.js';

async function main() {
  const pattern = process.argv[2];
  if (!pattern) { console.log('사용법: repromote <URL 일부>'); process.exit(1); }
  const link = await prisma.inboundLink.findFirst({
    where: { normalizedUrl: { contains: pattern } },
  });
  if (!link) { console.log('not found'); process.exit(1); }
  console.log('re-promoting:', link.url);
  const result = await promoteInboundLink(link.id, 'manual');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
