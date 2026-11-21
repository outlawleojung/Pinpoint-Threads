import { prisma } from '../../src/db/prisma.js';

// 남성 계정에 있는 여성향 쇼핑, 여성 계정에 있는 남성향 쇼핑 찾아서 교정
const MALE_ONLY = ['면도', '그루밍'];
const FEMALE_ONLY = ['파데', '쿠션', '립', '애교살', '홍조', '화장', '모공', '섀도', '블러셔', '타이츠', '레깅스', '블라우스', '스커트', '원피스'];

const minyoung = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });
const pikkseetem = await prisma.account.findFirstOrThrow({ where: { handle: 'pikkseetem' } });
const hanseoa = await prisma.account.findFirstOrThrow({ where: { handle: 'hanseoa.pick' } });
const kle0 = await prisma.account.findFirstOrThrow({ where: { handle: 'kle0_lee' } });

const femaleAccounts = [pikkseetem.id, hanseoa.id, kle0.id];
const maleAccountId = minyoung.id;

const pending = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  select: { id: true, accountId: true, generatedBody: true, account: { select: { handle: true } } },
});

let fixes = 0;
for (const p of pending) {
  const body = (p.generatedBody ?? '').toLowerCase();
  const isFemaleProduct = FEMALE_ONLY.some(k => body.includes(k));
  const isMaleProduct = MALE_ONLY.some(k => body.includes(k));

  // 남성 계정에 여성향 → pikkseetem으로
  if (p.accountId === maleAccountId && isFemaleProduct && !isMaleProduct) {
    await prisma.post.update({ where: { id: p.id }, data: { accountId: pikkseetem.id } });
    console.log(`✅ @minyoung.jung → @pikkseetem | ${(p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 60)}`);
    fixes++;
  }

  // 여성 계정에 남성 전용 → minyoung으로
  if (femaleAccounts.includes(p.accountId) && isMaleProduct && !isFemaleProduct) {
    await prisma.post.update({ where: { id: p.id }, data: { accountId: maleAccountId } });
    console.log(`✅ @${p.account.handle} → @minyoung.jung | ${(p.generatedBody ?? '').replace(/\n/g, ' ').slice(0, 60)}`);
    fixes++;
  }
}

console.log(`\n수정: ${fixes}건`);

// 최종 배분
const final = await prisma.post.groupBy({
  by: ['accountId'],
  where: { kind: 'SHOPPING', state: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
  _count: true,
});
for (const f of final) {
  const acc = await prisma.account.findUnique({ where: { id: f.accountId }, select: { handle: true } });
  console.log(`  @${acc?.handle}: ${f._count}건`);
}

await prisma.$disconnect();
