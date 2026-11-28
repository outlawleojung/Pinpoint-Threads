import { prisma } from '../../src/db/prisma.js';
const IDS = [
  'cmx0jo7x70003iff4tj6vqifj',
  'cmwyve5ip0030ifex0ghrd8ov',
  'cmwyve8ib0032ifex2369mh3e',
];
for (const id of IDS) {
  const p = await prisma.post.findUnique({
    where: { id },
    select: { state: true, generatedBody: true, scheduledAt: true, createdAt: true, account: { select: { handle: true } } },
  });
  if (!p) { console.log(`${id}: NOT FOUND`); continue; }
  console.log(`\n═══ @${p.account.handle} [${p.state}] ═══`);
  console.log(`  createdAt: ${p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  if (p.scheduledAt) console.log(`  scheduledAt: ${p.scheduledAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  body: ${p.generatedBody}`);
}
// kle0_lee 직전 스하리 (연속 금지 트리거)
const kle0 = await prisma.account.findFirst({ where: { handle: 'kle0_lee' } });
if (kle0) {
  const latest = await prisma.post.findFirst({
    where: { accountId: kle0.id, kind: 'SHARING', state: { in: ['APPROVED', 'PENDING_APPROVAL', 'PUBLISHED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, state: true, scheduledAt: true, generatedBody: true, createdAt: true },
  });
  if (latest) {
    console.log(`\n═══ @kle0_lee 최신 SHARING [${latest.state}] ═══`);
    console.log(`  ${latest.id}`);
    console.log(`  createdAt: ${latest.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    if (latest.scheduledAt) console.log(`  scheduledAt: ${latest.scheduledAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    console.log(`  body: ${latest.generatedBody}`);
  }
}
await prisma.$disconnect();
