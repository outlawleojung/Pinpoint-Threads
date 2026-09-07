import assert from 'node:assert';
import { parseShoppingConnectLink } from '../../src/infra/naver/shopping-connect-link.js';

// canonical smartstore
const a = parseShoppingConnectLink('https://smartstore.naver.com/myshop/products/1234567890?query=1');
assert.equal(a.productId, '1234567890');
assert.equal(a.productUrl, 'https://smartstore.naver.com/myshop/products/1234567890');
assert.equal(a.connectUrl, 'https://smartstore.naver.com/myshop/products/1234567890?query=1');

// brand store 형식
const b = parseShoppingConnectLink('https://brand.naver.com/somebrand/products/987654321');
assert.equal(b.productId, '987654321');

// 축약 링크 → productId 미확정
const c = parseShoppingConnectLink('https://naver.me/abcd1234');
assert.equal(c.productId, null);
assert.equal(c.connectUrl, 'https://naver.me/abcd1234');

console.log('OK: link parser');
