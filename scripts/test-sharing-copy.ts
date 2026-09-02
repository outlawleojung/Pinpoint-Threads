import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { generateSharingCopy } from '../src/modules/pipeline-b/sharing-copywriter/index.js';

async function main() {
  const arg = process.argv[2];
  const variantCount = Number(process.argv[3] ?? '5');

  const accounts = arg
    ? await prisma.account.findMany({ where: { handle: arg } })
    : await prisma.account.findMany({ where: { isActive: true }, orderBy: { handle: 'asc' } });

  for (const acc of accounts) {
    console.log('\n═══════════════════════════════════════');
    console.log(`@${acc.handle}`);
    console.log('═══════════════════════════════════════');
    try {
      const r = await generateSharingCopy({ accountId: acc.id, variantCount });
      console.log(`팔로워: ${r.followersCount}명 · 구간: ${r.followerBucket}\n`);
      r.variants.forEach((v, i) => {
        console.log(`── variant ${i + 1} · [${v.hookLabel}] · ref: ${v.referencesUsed.map(x => '@' + x.sourceHandle).join(', ') || '(none)'}`);
        console.log(v.body);
        console.log();
      });
    } catch (err) {
      console.error('  실패:', (err as Error).message);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
