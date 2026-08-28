import { buildCoupangAuthHeader } from './coupang-hmac.js';
import type { CommerceAdapter, CommerceSearchResult } from './types.js';

/**
 * Coupang Partners Open API 클라이언트.
 * - Search:   GET  /v2/providers/affiliate_open_api/apis/openapi/products/search
 * - Deeplink: POST /v2/providers/affiliate_open_api/apis/openapi/v1/deeplink
 *
 * Rate limits (실측 필요):
 * - Search: 시간당 최대 10회
 * - Deeplink: 시간당 60회 (문서화 확인 필요)
 */

const BASE_URL = 'https://api-gateway.coupang.com';
const SEARCH_PATH = '/v2/providers/affiliate_open_api/apis/openapi/products/search';
const DEEPLINK_PATH = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';

interface CoupangSearchResponse {
  rCode: string;
  rMessage: string;
  data: {
    landingUrl?: string;
    productData: Array<{
      productId: number;
      productName: string;
      productPrice: number;
      productImage: string;
      productUrl: string;
      keyword?: string;
      rank?: number;
      isRocket: boolean;
      isFreeShipping: boolean;
      categoryName?: string;
    }>;
  };
}

interface CoupangDeeplinkResponse {
  rCode: string;
  rMessage: string;
  data: Array<{
    originalUrl: string;
    shortenUrl: string;
    landingUrl: string;
  }>;
}

export class CoupangAdapter implements CommerceAdapter {
  readonly channel = 'COUPANG' as const;

  constructor(
    private readonly accessKey: string,
    private readonly secretKey: string,
  ) {}

  private assertCredentials(): void {
    if (!this.accessKey || !this.secretKey) {
      throw new CoupangConfigError('COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY not set in .env');
    }
  }

  async search(keyword: string, opts?: { limit?: number }): Promise<CommerceSearchResult[]> {
    this.assertCredentials();
    const limit = Math.min(opts?.limit ?? 5, 10); // API 상한 10
    const query = `keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
    const authorization = buildCoupangAuthHeader({
      method: 'GET',
      path: SEARCH_PATH,
      query,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
    });

    const url = `${BASE_URL}${SEARCH_PATH}?${query}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json;charset=UTF-8',
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new CoupangApiError(`search HTTP ${resp.status}: ${body.slice(0, 500)}`);
    }
    const json = (await resp.json()) as CoupangSearchResponse;
    if (json.rCode !== '0') {
      throw new CoupangApiError(`search rCode=${json.rCode} msg=${json.rMessage}`);
    }

    return json.data.productData.map((p) => ({
      channel: 'COUPANG' as const,
      externalId: String(p.productId),
      productName: p.productName,
      // Search API가 돌려주는 productUrl은 이미 트래킹 형식(`link.coupang.com/re/AFFSDP?...`)이라
      // Deeplink API가 400 (url convert failed). productId로 canonical 상품 페이지 URL 재구성.
      productUrl: `https://www.coupang.com/vp/products/${p.productId}`,
      thumbnailUrl: p.productImage,
      price: p.productPrice,
      category: p.categoryName,
    }));
  }

  async generateDeeplink(productUrl: string): Promise<string> {
    this.assertCredentials();
    const authorization = buildCoupangAuthHeader({
      method: 'POST',
      path: DEEPLINK_PATH,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
    });

    const resp = await fetch(`${BASE_URL}${DEEPLINK_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json;charset=UTF-8',
      },
      body: JSON.stringify({ coupangUrls: [productUrl] }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new CoupangApiError(`deeplink HTTP ${resp.status}: ${body.slice(0, 500)}`);
    }
    const json = (await resp.json()) as CoupangDeeplinkResponse;
    if (json.rCode !== '0' || !json.data?.[0]) {
      throw new CoupangApiError(`deeplink rCode=${json.rCode} msg=${json.rMessage}`);
    }
    return json.data[0].shortenUrl;
  }
}

export class CoupangApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoupangApiError';
  }
}

export class CoupangConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoupangConfigError';
  }
}
