import { prisma } from '../../src/db/prisma.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

// 오늘 생성된 PENDING_APPROVAL 쇼핑 포스트 확인
const posts = await prisma.post.findMany({
  where: { kind: 'SHOPPING', state: 'PENDING_APPROVAL', createdAt: { gte: new Date(Date.now() - 3600000) } },
  include: { account: { select: { handle: true } }, sourceItem: { select: { sourceUrl: true } } },
  orderBy: { createdAt: 'asc' },
});

console.log(`PENDING_APPROVAL 쇼핑: ${posts.length}건\n`);

const minyoung = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });

// 카피 내용으로 남성향 판별 → minyoung.jung 으로 이동
const MALE_SIGNALS = ['뉴발란스', '9060', '러닝화', '아식스', '운동화', '나이키', '에어포스', '덩크', '조던'];

let moved = 0;
for (const p of posts) {
  const body = (p.generatedBody ?? '').toLowerCase();
  const isMale = MALE_SIGNALS.some(k => body.includes(k.toLowerCase()));
  console.log(
    p.account.handle.padEnd(16),
    isMale ? '→ minyoung.jung' : '(유지)',
    (p.generatedBody ?? '').slice(0, 50).replace(/\n/g, ' '),
  );
  if (isMale && p.account.handle !== 'minyoung.jung') {
    await prisma.post.update({ where: { id: p.id }, data: { accountId: minyoung.id } });
    await sendApprovalRequest(p.id);
    moved++;
    console.log(`  ✅ 재배정 완료 + 카드 재발송`);
  }
}

console.log(`\n총 ${moved}건 minyoung.jung으로 재배정`);
await prisma.$disconnect();
