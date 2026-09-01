import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const accounts = await prisma.account.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, handle: true, personaPrompt: true, isActive: true },
  });
  console.log(`총 ${accounts.length}개 계정\n`);
  for (const a of accounts) {
    console.log(`=== @${a.handle} (${a.isActive ? '활성' : '비활성'}) ===`);
    console.log(a.personaPrompt || '(비어있음)');
    console.log('');
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
