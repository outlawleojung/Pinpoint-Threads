import { createHmac } from 'node:crypto';

/**
 * Coupang Open API HMAC-SHA256 서명 (Coupang Partners).
 * 공식 스펙: https://developers.coupang.com/hc/en-us/articles/360033396034
 *
 * datetime: YYMMDDTHHMMSSZ (UTC, 예: 250109T143022Z)
 * message: datetime + method + path + query   (구분자 없음)
 * signature: HMAC-SHA256(secret, message).hex()
 * header:  CEA algorithm=HmacSHA256, access-key={key}, signed-date={dt}, signature={sig}
 */

export function buildCoupangDatetime(now = new Date()): string {
  const y = now.getUTCFullYear() % 100;
  const M = now.getUTCMonth() + 1;
  const D = now.getUTCDate();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const s = now.getUTCSeconds();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(y)}${p(M)}${p(D)}T${p(h)}${p(m)}${p(s)}Z`;
}

export function buildCoupangSignature(input: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;   // e.g. "/v2/providers/affiliate_open_api/apis/openapi/products/search"
  query?: string; // e.g. "keyword=%EA%B0%80%EC%8A%B5%EA%B8%B0&limit=5" (already URL-encoded, no leading "?")
  secretKey: string;
  datetime?: string;
}): { signature: string; datetime: string; message: string } {
  const datetime = input.datetime ?? buildCoupangDatetime();
  const query = input.query ?? '';
  const message = datetime + input.method + input.path + query;
  const signature = createHmac('sha256', input.secretKey).update(message).digest('hex');
  return { signature, datetime, message };
}

export function buildCoupangAuthHeader(input: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: string;
  accessKey: string;
  secretKey: string;
  datetime?: string;
}): string {
  const { signature, datetime } = buildCoupangSignature(input);
  return `CEA algorithm=HmacSHA256, access-key=${input.accessKey}, signed-date=${datetime}, signature=${signature}`;
}
