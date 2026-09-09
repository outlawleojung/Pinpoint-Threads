import { prisma } from '../../src/db/prisma.js';

async function main() {
  const rows = await prisma.naverPost.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, state: true, title: true, topic: true, createdAt: true },
  });
  console.log(`총 ${rows.length}건\n`);
  for (const r of rows) {
    console.log(`[${r.state}·${r.kind}] ${r.title ?? r.topic ?? '(무제)'}  <${r.id}>`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
