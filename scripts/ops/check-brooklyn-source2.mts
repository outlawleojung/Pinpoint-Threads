import { prisma } from '../../src/db/prisma.js';

const inbound = await prisma.inboundLink.findFirst({
  where: { url: { contains: 'DfdbCCcDbF3' } },
});
console.log('rawText:', inbound?.rawText);
console.log('mediaUrls:', JSON.stringify(inbound?.mediaUrls));

const post = await prisma.post.findUnique({
  where: { id: 'cmw9do07k00018c3jys5hiv31' },
  include: { sourceItem: true },
});
console.log('\nsourceItem rawText:', post?.sourceItem?.rawText);
console.log('mediaUrls:', JSON.stringify(post?.mediaUrls));

await prisma.$disconnect();
