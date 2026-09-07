export interface ParsedConnectLink {
  productId: string | null;
  productUrl: string | null;
  connectUrl: string;
}

// smartstore.naver.com/<store>/products/<id> · brand.naver.com/<store>/products/<id>
const SMARTSTORE_RE = /^https?:\/\/(?:smartstore|brand)\.naver\.com\/[^/]+\/products\/(\d+)/i;

export function parseShoppingConnectLink(input: string): ParsedConnectLink {
  const connectUrl = input.trim();
  const m = connectUrl.match(SMARTSTORE_RE);
  if (m) {
    const productId = m[1]!;
    const base = connectUrl.split('?')[0]!;
    return { productId, productUrl: base, connectUrl };
  }
  return { productId: null, productUrl: null, connectUrl };
}
