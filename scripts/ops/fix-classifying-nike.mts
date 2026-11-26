import { prisma } from '../../src/db/prisma.js';

// 기존 불량 CLASSIFYING 포스트 삭제
const deleted = await prisma.post.delete({ where: { id: 'cmwcs8m0p002oifct2trkr9ah' } });
console.log('삭제:', deleted.id, deleted.state);

await prisma.$disconnect();
