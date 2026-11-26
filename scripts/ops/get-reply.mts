import { prisma } from '../../src/db/prisma.js';
const p = await prisma.post.findUnique({
  where: { id: 'cmw7xrbyc00038c8zzxsfms5g' },
  select: { generatedReply: true },
});
console.log(p?.generatedReply ?? '없음');
await prisma.$disconnect();
