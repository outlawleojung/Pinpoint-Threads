import 'dotenv/config';
import { CoupangAdapter } from '../src/infra/commerce/coupang-client.js';
import { env } from '../src/config/env.js';

async function main() {
  const c = new CoupangAdapter(env.COUPANG_ACCESS_KEY!, env.COUPANG_SECRET_KEY!);
  const keyword = process.argv[2] ?? 'AZTK 쿠션';
  const limit = Number(process.argv[3] ?? '10');
  console.log(`=== Coupang search: "${keyword}" (limit=${limit}) ===\n`);
  const results = await c.search(keyword, { limit });
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.productName}`);
    console.log(`   productUrl: ${r.productUrl}`);
    console.log(`   thumb: ${r.thumbnailUrl?.slice(0, 100)}`);
    console.log();
  });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
