import { prisma } from '../../src/db/prisma.js';
const r = await prisma.account.count();
console.log('DB 연결 OK, 계정 수:', r);
await prisma.$disconnect();
