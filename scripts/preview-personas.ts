import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { generateBody } from '../src/modules/shared/copywriter/persona-preview.js';

const SOURCE = process.argv[2] ?? `족저근막염이면 아식스가 진리라고 하신 분.. 계신 방향으로 절 올립니다 ..
호카 본디9도 편해서 신었는데 밑창 닳는 속도가 지우개 수준이었거든요ㄷㄷ
아식스 젤카야노는 6개월 신어도 밑창 멀쩡함`;

async function main() {
  console.log(`=== 원본 ===\n${SOURCE}\n`);
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, handle: true, personaPrompt: true },
  });

  console.log(`=== ${accounts.length}계정 프리뷰 ===\n`);
  for (const acc of accounts) {
    try {
      const body = await generateBody({
        sourceText: SOURCE,
        sourceLanguage: 'ko',
        personaPrompt: acc.personaPrompt,
        accountSeed: acc.id,
      });
      console.log(`--- @${acc.handle} ---`);
      console.log(body);
      console.log('');
    } catch (err: any) {
      console.log(`--- @${acc.handle} — 실패 ---`);
      console.log(err.message);
      console.log('');
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
