import { prisma } from '../../src/db/prisma.js';

const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL' },
  select: { id: true, createdAt: true, cardVersion: true, account: { select: { handle: true } }, generatedBody: true, sourceBrief: true },
  orderBy: { createdAt: 'asc' },
});

for (const p of posts) {
  const created = p.createdAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const body = (p.generatedBody || '').slice(0, 30).replace(/\n/g, ' ');
  const brief = p.sourceBrief as any;
  const holdApproval = brief?.holdApproval ?? 'N/A';
  console.log(`${p.account.handle.padEnd(15)} | 생성: ${created} | cardV: ${p.cardVersion} | hold: ${holdApproval} | ${body}`);
}

await prisma.$disconnect();
