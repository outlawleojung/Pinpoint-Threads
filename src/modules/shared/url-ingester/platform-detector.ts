import { InboundPlatform } from '@prisma/client';

/**
 * URL 문자열에서 InboundPlatform을 감지.
 * 도메인 매칭 + 단축링크 alias 처리.
 */

const DOMAIN_MAP: Array<{ pattern: RegExp; platform: InboundPlatform }> = [
  { pattern: /(?:^|\.)threads\.(?:net|com)$/i, platform: InboundPlatform.THREADS },
  { pattern: /(?:^|\.)tiktok\.com$/i, platform: InboundPlatform.TIKTOK },
  { pattern: /(?:^|\.)vm\.tiktok\.com$/i, platform: InboundPlatform.TIKTOK },
  { pattern: /(?:^|\.)vt\.tiktok\.com$/i, platform: InboundPlatform.TIKTOK },
  { pattern: /(?:^|\.)xiaohongshu\.com$/i, platform: InboundPlatform.XIAOHONGSHU },
  { pattern: /(?:^|\.)xhslink\.com$/i, platform: InboundPlatform.XIAOHONGSHU },
  { pattern: /(?:^|\.)instagram\.com$/i, platform: InboundPlatform.INSTAGRAM },
  { pattern: /(?:^|\.)instagr\.am$/i, platform: InboundPlatform.INSTAGRAM },
];

export function detectPlatform(urlOrHost: string): InboundPlatform {
  const host = extractHost(urlOrHost);
  if (!host) return InboundPlatform.UNKNOWN;
  for (const { pattern, platform } of DOMAIN_MAP) {
    if (pattern.test(host)) return platform;
  }
  return InboundPlatform.UNKNOWN;
}

function extractHost(input: string): string | null {
  try {
    const withProto = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const u = new URL(withProto);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 문자열에서 http/https URL 후보 목록 추출.
 * 텔레그램 메시지·문서 등에서 URL만 골라내기.
 */
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  // 뒤에 붙은 부호(마침표·괄호 등) 정리
  return matches.map((u) => u.replace(/[),.!?]+$/, ''));
}

/**
 * URL 정규화 (쿼리 파라미터 트래킹 제거 · 프래그먼트 제거 · 소문자 도메인).
 * 실제 short URL 확장은 adapter가 fetch 시 처리.
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'igshid',
  '_r', // xiaohongshu 링크에 흔한 param
  '_t',
]);

export function normalizeUrl(url: string): string {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const u = new URL(withProto);
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    const toDelete: string[] = [];
    u.searchParams.forEach((_v, k) => {
      if (TRACKING_PARAMS.has(k.toLowerCase())) toDelete.push(k);
    });
    toDelete.forEach((k) => u.searchParams.delete(k));
    // Threads URL 뒤 슬래시 정규화
    if (u.pathname.endsWith('/') && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url;
  }
}
