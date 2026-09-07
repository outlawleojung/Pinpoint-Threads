import { resolveConnectUrl, fetchProductImages } from '../../src/infra/naver/smartstore-detail.js';

async function main() {
  const url = process.argv[2];
  if (!url) { console.error('사용법: pnpm tsx scripts/naver/verify-detail.ts <쇼핑커넥트/상품 URL>'); process.exit(2); }
  const resolved = await resolveConnectUrl(url);
  console.log('resolved', resolved);
  const imgs = await fetchProductImages(resolved, { max: 5 });
  console.log('images', imgs.length, imgs.slice(0, 3));
  console.log('OK: smartstore detail (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
