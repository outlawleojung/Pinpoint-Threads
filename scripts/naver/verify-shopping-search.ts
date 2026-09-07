import { NaverShoppingAdapter } from '../../src/infra/commerce/naver-shopping-client.js';
import { env } from '../../src/config/env.js';

async function main() {
  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
    console.error('SKIP: NAVER_CLIENT_ID/SECRET 미설정 — .env 설정 후 재실행');
    process.exit(2);
  }
  const adapter = new NaverShoppingAdapter(env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET);
  const results = await adapter.search('무선 가습기', { limit: 3 });
  console.log('count', results.length);
  console.log(results.map((r) => ({ name: r.productName.slice(0, 30), price: r.price, id: r.externalId })));
  if (results.length === 0) throw new Error('빈 결과 — 쿼리/키 확인');
  console.log('OK: naver shopping search (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
