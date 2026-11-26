import { prisma } from '../../src/db/prisma.js';

// 현재 활성 상태만 (APPROVED + PENDING_APPROVAL)
const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: { in: ['APPROVED', 'PENDING_APPROVAL'] } },
  select: { id: true, state: true, account: { select: { handle: true } }, generatedBody: true },
  orderBy: { createdAt: 'asc' },
});

console.log(`활성 쇼핑 ${posts.length}건\n`);

// 상품 키워드로 분류
for (const p of posts) {
  const body = (p.generatedBody || '').slice(0, 60).replace(/\n/g, ' ');
  let product = '?';
  const b = p.generatedBody || '';
  if (b.includes('아디다스')) product = '아디다스';
  if (b.includes('나이키') || b.includes('에어포스')) product = '나이키';
  if (b.includes('뉴발란스') || b.includes('990')) product = '뉴발란스';
  if (b.includes('헌터')) product = '헌터';
  if (b.includes('아식스')) product = '아식스';
  if (b.includes('로퍼')) product = product === '?' ? '로퍼' : product + ' 로퍼';
  if (b.includes('삼선') || b.includes('가죽')) product = product === '?' ? '아디다스 자켓' : product;
  console.log(`${p.state.padEnd(18)} | ${p.account.handle.padEnd(15)} | ${product.padEnd(15)} | ${body}`);
}

await prisma.$disconnect();
