import { prisma } from '../../src/db/prisma.js';
const p = await prisma.post.findUnique({
  where: { id: 'cmvuse8hi00028clfwj1626gi' },
  include: { sourceItem: true, commerceProduct: true, account: { select: { handle: true, personaPrompt: true } } },
});
console.log('kind:', p?.kind);
console.log('commerceProduct:', p?.commerceProduct ? JSON.stringify(p.commerceProduct, null, 2) : 'null');
console.log('sourceItem rawText:', p?.sourceItem?.rawText ?? 'null');
console.log('generatedBody:', p?.generatedBody);
console.log('generatedReply:', p?.generatedReply);
console.log('mediaUrls:', p?.mediaUrls);
console.log('retryCount:', p?.retryCount);
await prisma.$disconnect();
