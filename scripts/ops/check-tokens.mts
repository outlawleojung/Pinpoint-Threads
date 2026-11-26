import { prisma } from '../../src/db/prisma.js';
const accounts = await prisma.account.findMany({
  select: { handle: true, tokenExpiresAt: true, isActive: true },
  orderBy: { handle: 'asc' },
});
const now = new Date();
for (const a of accounts) {
  const exp = a.tokenExpiresAt;
  const days = exp ? Math.round((exp.getTime() - now.getTime()) / 86400000) : -999;
  const status = !exp ? '❌ 없음' : days < 0 ? '❌ 만료' : days < 7 ? '⚠️ ' + days + '일' : '✅ ' + days + '일';
  console.log(a.handle.padEnd(18), a.isActive ? 'active' : 'OFF   ', status, exp?.toISOString().slice(0,10) ?? '-');
}
await prisma.$disconnect();
