import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

/**
 * 계정별 audienceGender 세팅 (남성/여성/유니섹스).
 * 페르소나에 맞춰:
 *   - minyoung.jung: male (30대 남성 IT)
 *   - sookck.kate, kle0_lee, _blanchatt_, pikkseetem: female
 */
const MAPPING: Record<string, 'male' | 'female' | 'unisex'> = {
  'minyoung.jung': 'male',
  'sookck.kate': 'female',
  'kle0_lee': 'female',
  '_blanchatt_': 'female',
  'pikkseetem': 'female',
};

async function main() {
  for (const [handle, gender] of Object.entries(MAPPING)) {
    const acc = await prisma.account.findFirst({ where: { handle } });
    if (!acc) { console.log(`⚠️ @${handle} 없음`); continue; }
    await prisma.account.update({ where: { id: acc.id }, data: { audienceGender: gender } });
    console.log(`✅ @${handle} → ${gender}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
