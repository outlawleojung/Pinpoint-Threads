import type { CommerceAdapter, CommerceSearchResult } from './types.js';

// TODO(Phase 2): Musinsa Curator API 스펙 확정 후 구현
export class MusinsaAdapter implements CommerceAdapter {
  readonly channel = 'MUSINSA' as const;

  constructor(
    private readonly apiKey: string,
    private readonly partnerId: string,
  ) {}

  async search(_keyword: string, _opts?: { limit?: number }): Promise<CommerceSearchResult[]> {
    throw new Error('MusinsaAdapter.search not implemented (Phase 2)');
  }

  async generateDeeplink(_productUrl: string): Promise<string> {
    throw new Error('MusinsaAdapter.generateDeeplink not implemented (Phase 2)');
  }
}
