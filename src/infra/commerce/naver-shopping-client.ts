import type { CommerceAdapter, CommerceSearchResult } from './types.js';

const BASE_URL = 'https://openapi.naver.com/v1/search/shop.json';

interface NaverShopItem {
  title: string;        // <b> 태그 포함될 수 있음
  link: string;
  image: string;
  lprice: string;
  productId: string;
  brand?: string;
  maker?: string;
  category1?: string;
}
interface NaverShopResponse { items: NaverShopItem[] }

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

export class NaverShoppingAdapter implements CommerceAdapter {
  readonly channel = 'NAVER' as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private assert(): void {
    if (!this.clientId || !this.clientSecret) {
      throw new NaverShoppingConfigError('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET not set in .env');
    }
  }

  async search(keyword: string, opts?: { limit?: number }): Promise<CommerceSearchResult[]> {
    this.assert();
    const display = Math.min(opts?.limit ?? 5, 10);
    const url = `${BASE_URL}?query=${encodeURIComponent(keyword)}&display=${display}&sort=sim`;
    const resp = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': this.clientId,
        'X-Naver-Client-Secret': this.clientSecret,
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new NaverShoppingApiError(`shop search HTTP ${resp.status}: ${body.slice(0, 500)}`);
    }
    const json = (await resp.json()) as NaverShopResponse;
    return (json.items ?? []).map((it) => ({
      channel: 'NAVER' as const,
      externalId: it.productId,
      productName: stripTags(it.title),
      productUrl: it.link,
      thumbnailUrl: it.image,
      price: Number(it.lprice) || undefined,
      category: it.category1,
    }));
  }

  async searchByName(name: string): Promise<CommerceSearchResult | null> {
    const rows = await this.search(name, { limit: 1 });
    return rows[0] ?? null;
  }

  // 쇼핑커넥트 제휴 링크는 사용자가 발급·제공하므로 deeplink 생성 개념 없음. 입력 그대로 반환.
  async generateDeeplink(productUrl: string): Promise<string> {
    return productUrl;
  }
}

export class NaverShoppingApiError extends Error {
  constructor(message: string) { super(message); this.name = 'NaverShoppingApiError'; }
}
export class NaverShoppingConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'NaverShoppingConfigError'; }
}
