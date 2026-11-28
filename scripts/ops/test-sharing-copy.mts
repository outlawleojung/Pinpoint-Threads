import { prisma } from '../../src/db/prisma.js';
import { generateSharingCopy } from '../../src/modules/pipeline-b/sharing-copywriter/index.js';

const HANDLES = ['pikkseetem', 'minyoung.jung', 'hanseoa.pick', 'kle0_lee'];
for (const handle of HANDLES) {
  const acc = await prisma.account.findFirst({ where: { handle } });
  if (!acc) { console.log(`@${handle}: not found`); continue; }
  try {
    const r = await generateSharingCopy({ accountId: acc.id, variantCount: 2 });
    console.log(`\n═══ @${handle} (${r.followersCount}팔) ═══`);
    r.variants.forEach((v, i) => {
      console.log(`\n[${i + 1}] (${v.body.length}자)`);
      console.log(v.body);
    });
  } catch (e) {
    console.log(`\n═══ @${handle} FAILED: ${(e as Error).message} ═══`);
  }
}
await prisma.$disconnect();
