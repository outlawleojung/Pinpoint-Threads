/**
 * Discovery(발굴) 모듈 타입.
 *
 * 정서 맞는 해외(일본·중국·동남아) 바이럴 후보를 수집해 텔레그램 `/소재` 로 노출한다.
 * 후보를 고르면 기존 파이프라인(일상/쇼핑)으로 재생산 → 승인 카드.
 * 자동 발행 아님 · 사람이 텔레그램에서 선택. → docs/08-decisions/2026-09-28-telegram-native-operation.md
 */

export type DiscoveryPlatform = 'x' | 'tiktok';

export interface DiscoveryCandidate {
  /** 콜백 조회용 짧은 id (Redis 키). */
  id: string;
  /** 후보를 만든 어댑터 이름 (jp-animal-x 등). */
  adapter: string;
  platform: DiscoveryPlatform;
  sourceUrl: string;
  /** 한 줄 미리보기(본문 앞부분). */
  title: string;
  /** 원문 텍스트 전체 (재생산 시 카피 참고). */
  text: string;
  thumbnailUrl?: string;
  mediaCount: number;
  hasVideo: boolean;
  authorHandle?: string;
  lang?: string;
  /** 재생산 시 어느 파이프라인으로 보낼지 힌트. */
  kindHint: 'daily' | 'shopping';
  /** 랭킹용 점수(대개 좋아요 수). */
  score: number;
  foundAt: string;
}

export interface DiscoveryAdapterResult {
  adapter: string;
  candidates: DiscoveryCandidate[];
  /** 소스 확보 실패·차단 등으로 정상 동작 못한 경우 사유(있으면 degraded). */
  degradedReason?: string;
}

export interface DiscoveryAdapter {
  readonly name: string;
  /** 정서 맞는 해외 바이럴 후보 수집. limit = 이 어댑터가 반환할 최대 후보 수. */
  discover(limit: number): Promise<DiscoveryAdapterResult>;
}
