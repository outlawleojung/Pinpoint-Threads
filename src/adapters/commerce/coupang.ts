import type { CommerceAdapter, CommerceSearchResult } from './types.js';

// TODO(Phase 2): HMAC-SHA256 서명 + 실제 Coupang Partners Open API 호출
// 문서: https://partners.coupang.com/#help/open-api
export class CoupangAdapter implements CommerceAdapter {
  readonly channel = 'COUPANG' as const;

  constructor(
    private readonly accessKey: string,
    private readonly secretKey: string,
  ) {}

  async search(_keyword: string, _opts?: { limit?: number }): Promise<CommerceSearchResult[]> {
    throw new Error('CoupangAdapter.search not implemented (Phase 2)');
  }

  async generateDeeplink(_productUrl: string): Promise<string> {
    throw new Error('CoupangAdapter.generateDeeplink not implemented (Phase 2)');
  }
}
