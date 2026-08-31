import 'dotenv/config';
import { env } from '../src/config/env.js';
import { CoupangAdapter } from '../src/infra/commerce/coupang-client.js';

async function main() {
  console.log('--- [쿠팡 Best Category API] ---');
  const c = new CoupangAdapter(env.COUPANG_ACCESS_KEY ?? '', env.COUPANG_SECRET_KEY ?? '');
  try {
    const r = await c.getBestByCategory(1001, 3);
    console.log(`✅ 여성패션 Best: ${r.length}개`);
    r.forEach((item) =>
      console.log(`  ${item.productName?.substring(0, 50)} — ₩${item.productPrice}`),
    );
  } catch (e: any) {
    console.log(`❌ getBestByCategory 에러: ${e.message}`);
  }

  try {
    const s = await c.search('여름 원피스', { limit: 3 });
    console.log(`✅ 검색 "여름 원피스": ${s.length}개`);
    s.forEach((item) =>
      console.log(`  ${item.productName?.substring(0, 50)} — ₩${item.productPrice}`),
    );
  } catch (e: any) {
    console.log(`❌ search 에러: ${e.message}`);
  }

  process.exit(0);
}

main();
