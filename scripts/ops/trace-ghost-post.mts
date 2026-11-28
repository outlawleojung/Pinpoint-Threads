// cmx0kj2ss0005if8x7dbi7lrn 어디서 왔는지 추적
import { prisma } from '../../src/db/prisma.js';

const p = await prisma.post.findUnique({
  where: { id: 'cmx0kj2ss0005if8x7dbi7lrn' },
});
console.log('Full Post:', JSON.stringify(p, null, 2));

// 최근 1시간 내 생성된 전 SHARING Post
console.log('\n═══ 최근 1시간 SHARING Post ═══');
const recent = await prisma.post.findMany({
  where: {
    kind: 'SHARING',
    createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
  },
  orderBy: { createdAt: 'asc' },
  select: { id: true, state: true, generatedBody: true, createdAt: true, metadata: true, account: { select: { handle: true } } },
});
for (const p of recent) {
  const t = p.createdAt.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`${t} ${p.id} @${p.account.handle} [${p.state}]`);
  console.log(`  body: ${p.generatedBody}`);
  console.log(`  meta: ${JSON.stringify(p.metadata)}`);
}
await prisma.$disconnect();
