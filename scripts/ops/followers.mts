import { prisma } from '../../src/db/prisma.js';
import { ThreadsClient } from '../../src/infra/threads-client.js';
const c = new ThreadsClient();
for (const a of await prisma.account.findMany({ select: { handle: true, accessToken: true, followersCount: true, isActive: true } })) {
  let now: any = '-'; try { now = await c.fetchFollowersCount(a.accessToken!); } catch { now = 'err'; }
  console.log('F', a.handle.padEnd(14), a.isActive ? '' : '(휴식)', `db ${a.followersCount} → now ${now}`);
}
await prisma.$disconnect(); process.exit(0);
