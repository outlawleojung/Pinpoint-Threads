/**
 * Source Collector 어댑터 인터페이스.
 * 실제 수집 방식(Manual / Threads Insights / Apify / Playwright)은 나중에 결정하되,
 * 어댑터 패턴으로 나중에 갈아끼울 수 있도록 인터페이스 먼저 정의.
 * ADR 005 참조.
 */

export type SourcePlatform = 'threads' | 'xiaohongshu' | 'x' | 'instagram' | 'manual';

export interface SourceCriteria {
  platform?: SourcePlatform;
  category?: string;
  keywords?: string[];
  minEngagement?: number;
  language?: string;
  limit?: number;
}

export interface SourceCandidate {
  platform: SourcePlatform;
  sourceUrl: string;
  contentHash: string;      // 텍스트+미디어 URL 기반 dedup 키
  rawText: string;
  mediaUrls: string[];
  authorHandle?: string;
  language?: string;
  reactions?: {
    likes?: number;
    comments?: number;
    reposts?: number;
    capturedAt: Date;
  };
  collectedAt: Date;
}

export interface SourceAdapter {
  readonly name: string;
  fetch(criteria: SourceCriteria): Promise<SourceCandidate[]>;
}
