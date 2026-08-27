export type CommerceChannelKind = 'COUPANG' | 'MUSINSA';

export interface CommerceSearchResult {
  channel: CommerceChannelKind;
  externalId: string;
  productName: string;
  productUrl: string;
  thumbnailUrl: string;
  price?: number;
  rating?: number;
  category?: string;
}

export interface CommerceAdapter {
  readonly channel: CommerceChannelKind;
  search(keyword: string, opts?: { limit?: number }): Promise<CommerceSearchResult[]>;
  generateDeeplink(productUrl: string): Promise<string>;
}
