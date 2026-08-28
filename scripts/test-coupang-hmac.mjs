import { createHmac } from 'node:crypto';

// Verify HMAC logic against a known example
function buildDatetime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function sign({ method, path, query = '', secret, datetime }) {
  const msg = datetime + method + path + query;
  const sig = createHmac('sha256', secret).update(msg).digest('hex');
  return { msg, sig };
}

const dt = '250109T143022Z';
const r1 = sign({
  method: 'GET',
  path: '/v2/providers/affiliate_open_api/apis/openapi/products/search',
  query: 'keyword=test&limit=5',
  secret: 'test-secret',
  datetime: dt,
});
console.log('GET msg:', r1.msg);
console.log('GET sig:', r1.sig);

const r2 = sign({
  method: 'POST',
  path: '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink',
  secret: 'test-secret',
  datetime: dt,
});
console.log('POST msg:', r2.msg);
console.log('POST sig:', r2.sig);

console.log('Current UTC datetime format:', buildDatetime());
