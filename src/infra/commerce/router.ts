import type { CommerceAdapter, CommerceChannelKind } from './types.js';

// 카테고리 → 커머스 채널 라우팅 규칙 (CLAUDE.md §3 Commerce Channel Routing)
const FASHION_CATEGORIES = new Set([
  '의류',
  '신발',
  '패션잡화',
  '뷰티',
  'clothing',
  'shoes',
  'fashion',
  'beauty',
]);

// TODO: 무신사 배선 완료 후 라우팅 재활성화 (사용자 딥링크 수동 등록 방식)
// 현재는 무신사 미구현 → 전 카테고리 쿠팡 강제
const MUSINSA_ENABLED = false;

export function routeChannel(category: string | undefined): CommerceChannelKind {
  if (MUSINSA_ENABLED && category && FASHION_CATEGORIES.has(category.toLowerCase())) return 'MUSINSA';
  return 'COUPANG';
}

export interface CommerceRouterOpts {
  coupang: CommerceAdapter;
  musinsa: CommerceAdapter;
}

export class CommerceRouter {
  constructor(private readonly adapters: CommerceRouterOpts) {}

  pick(category: string | undefined): CommerceAdapter {
    const channel = routeChannel(category);
    return channel === 'MUSINSA' ? this.adapters.musinsa : this.adapters.coupang;
  }

  fallback(primary: CommerceChannelKind): CommerceAdapter {
    return primary === 'MUSINSA' ? this.adapters.coupang : this.adapters.musinsa;
  }
}
