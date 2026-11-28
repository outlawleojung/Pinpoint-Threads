import { prisma } from '../../src/db/prisma.js';
const accs = await prisma.account.findMany({
  where: { handle: { in: ['pikkseetem', 'minyoung.jung', 'hanseoa.pick', 'kle0_lee'] } },
  select: { handle: true, personaPrompt: true, audienceGender: true, followersCount: true },
});
for (const a of accs) {
  console.log(`\n═══ @${a.handle} (gender:${a.audienceGender} · ${a.followersCount ?? '?'}팔) ═══`);
  console.log(a.personaPrompt);
}
await prisma.$disconnect();
