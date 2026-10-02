import { prisma } from '../../db/prisma.js';

/**
 * 쇼핑 발행 적격 판정 — "팔로워 수"가 아니라 "실제 피드 도달"로 거른다.
 *
 * 근거(2026-09 실측): 팔로워가 제일 많은 계정(364)이 쇼핑 도달 19뷰로 최저였다.
 *   스하리로 얻은 팔로워는 죽은 계정이 많아 팔로워 수가 도달을 보장하지 않는다.
 *   스하리 글은 태그 검색으로 도달하므로(알고리즘 피드 아님) 건강 신호에서 제외하고,
 *   피드 알고리즘에 의존하는 DAILY·SHOPPING 조회수 중앙값으로 판정한다.
 *
 * 이력이 부족한(표본 <3) 신생 계정은 팔로워>100 폴백으로 판정 보류.
 */
// 판정 기준 (2026-09 실측 분포 근거):
//   억제 계정 sookck[6..251]·_blanchatt[9..296] = 중앙값 낮고 "한 번도 못 터짐"(max<300).
//   콘텐츠 계정 kle0·minyoung·pikkseetem = 중앙값 낮아도 최근 1만+ 터진 이력 → 알고리즘 분배 가능(건강).
//   ∴ "중앙값 낮음 AND 한 번도 못 터짐"만 억제로 보고 쇼핑 배제. 터질 수 있는 계정은 콘텐츠(카피)로 개선.
const REACH_FLOOR = 150;        // 중앙값 최소선 (억제 32 ↔ 콘텐츠 152 사이에서 깨끗이 갈림)
const BREAKOUT_PROOF = 1000;    // 최근 한 번이라도 이 이상 도달 = 계정 억제 아님(분배 가능) 증거
const FOLLOWER_FALLBACK = 300;  // 도달 이력 부족(신생)할 때만 쓰는 폴백. 강의 정본: 수익화글은 팔로워 300+부터(신생 계정 조기 수익화=정지 리스크). docs/00-overview/course-tactics.md §3
const WINDOW_DAYS = 21;
const MIN_SAMPLE = 3;

export interface FeedReachStats {
  median: number;
  max: number;
  n: number;
}

/** 최근 WINDOW_DAYS 일 피드형(DAILY+SHOPPING) 발행의 최신 스냅샷 조회수 통계. 표본 부족이면 null. */
export async function feedReachStats(accountId: string): Promise<FeedReachStats | null> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const posts = await prisma.post.findMany({
    where: {
      accountId,
      state: 'PUBLISHED',
      kind: { in: ['DAILY', 'SHOPPING'] },
      publishedAt: { gte: since },
    },
    select: {
      insightSnapshots: { select: { views: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 },
    },
  });
  const vals = posts
    .map((p) => p.insightSnapshots[0]?.views)
    .filter((v): v is number => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b);
  if (vals.length < MIN_SAMPLE) return null;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid]! : Math.round((vals[mid - 1]! + vals[mid]!) / 2);
  return { median, max: vals[vals.length - 1]!, n: vals.length };
}

/** 하위호환: 중앙값만 필요할 때. */
export async function feedReachMedian(accountId: string): Promise<number | null> {
  return (await feedReachStats(accountId))?.median ?? null;
}

// 붕괴(도달 완전 억제·섀도우밴/메타 제한) 판정 기준.
const COLLAPSE_MAX = 20;      // 최근 발행이 전부 이 미만이면 붕괴로 본다
const COLLAPSE_SAMPLE = 3;    // 최근 N개 연속

/**
 * "붕괴" 계정 — 최근 발행이 전 종류(스하리 포함) 전부 극저(<COLLAPSE_MAX)로 억제된 상태.
 *   메타 계정 제한·섀도우밴 신호. 글을 더 넣어도 워밍업이 안 되므로 **발행 대상에서 뺀다(휴식·관찰)**.
 */
export async function isCollapsedAccount(accountId: string): Promise<boolean> {
  // 최근 글엔 아직 스냅샷 없는(24h 전) 게 섞이므로 넉넉히 가져와 **스냅샷 있는 최근 3건**으로 판정.
  const posts = await prisma.post.findMany({
    where: { accountId, state: 'PUBLISHED', kind: { in: ['DAILY', 'SHOPPING', 'SHARING'] } },
    orderBy: { publishedAt: 'desc' },
    take: 12,
    select: { insightSnapshots: { select: { views: true }, orderBy: { hoursAfterPublish: 'desc' }, take: 1 } },
  });
  const vals = posts
    .map((p) => p.insightSnapshots[0]?.views)
    .filter((v): v is number => typeof v === 'number')
    .slice(0, COLLAPSE_SAMPLE);
  return vals.length >= COLLAPSE_SAMPLE && vals.every((v) => v < COLLAPSE_MAX);
}

/**
 * "도달이 막힌(억제)" 계정 판정 — 일상글 워밍업 대상.
 *   이력이 있는데(표본 충분) 중앙값도 낮고 최근 한 번도 안 터진 계정.
 *   ★ 단 **붕괴(collapsed) 계정은 제외** — 워밍업으로 안 살아나므로 휴식 대상이지 라우팅 대상이 아님.
 *   신생(이력 부족)은 여기 해당 X — 별개로 자연 워밍업.
 */
export async function isRecoveringAccount(accountId: string): Promise<boolean> {
  const s = await feedReachStats(accountId);
  if (s == null) return false;
  if (await isCollapsedAccount(accountId)) return false; // 붕괴는 워밍업 대상 아님
  return s.median < REACH_FLOOR && s.max < BREAKOUT_PROOF;
}

export interface ShoppingEligibility {
  ok: boolean;
  median: number | null;
  reason: string;
}

/**
 * 쇼핑 발행 적격 여부.
 *   적격 = 중앙값 ≥ REACH_FLOOR  또는  최근 최대도달 ≥ BREAKOUT_PROOF(터진 이력 = 건강).
 *   억제 = 둘 다 아님(중앙값 낮고 한 번도 못 터짐). → 쇼핑 배제, 일상글로 워밍업.
 *   이력 부족(신생) = 팔로워>100 폴백.
 */
/**
 * 링크(수익화) 글 하드 바닥: 팔로워 300명. 강의 11개 전부가 가장 강하게 금지 —
 * "300명 전 수익화 글 올린 계정은 한 달 뒤 아이디가 사라져 있다". 도달이 좋아도 예외 없음.
 * 300 미만은 링크 없이 일상글로 (사용자 결정 2026-09-30 · docs/00-overview/course-strategy.md §5).
 */
export const LINK_MIN_FOLLOWERS = 300;

/**
 * 링크 글 비율 상한: 계정의 최근 글 LINK_RATIO_WINDOW 개(이번 글 포함) 중 링크 글은 1개까지.
 *   근거(2026-10-02 실측): 9월 이후 링크 비율 45%(pikkseetem)·46%(kle0) 계정이 도달 붕괴,
 *   33%·27%·0% 계정은 정상. 표본 작음(가설) — 사용자 결정으로 강제.
 *   = 직전 발행 (WINDOW-1)개에 링크 글(고정댓글 발행됨)이 하나라도 있으면 이번엔 링크 금지.
 */
export const LINK_RATIO_WINDOW = 5;

export async function linkRatioBlock(accountId: string, excludePostId?: string): Promise<string | null> {
  const recent = await prisma.post.findMany({
    where: { accountId, state: 'PUBLISHED', ...(excludePostId ? { id: { not: excludePostId } } : {}) },
    orderBy: { publishedAt: 'desc' },
    take: LINK_RATIO_WINDOW - 1,
    select: { kind: true },
  });
  // 링크 생략된 쇼핑 글은 발행기가 DAILY 로 강등하므로, 남아 있는 SHOPPING = 링크 의도 글 (threadsReplyId 는 댓글 실패 시 비어 과소집계)
  const links = recent.filter((p) => p.kind === 'SHOPPING').length;
  if (links === 0) return null;
  return `최근 ${recent.length}개 글 중 링크 글 ${links}개 → 링크 비율 상한(${LINK_RATIO_WINDOW}개 중 1개) · 일상글을 더 올린 뒤에`;
}

export async function isShoppingEligible(
  accountId: string,
  followersCount: number | null | undefined,
): Promise<ShoppingEligibility> {
  if ((followersCount ?? 0) < LINK_MIN_FOLLOWERS) {
    return {
      ok: false,
      median: null,
      reason: `팔로워 ${followersCount ?? 0}명 < ${LINK_MIN_FOLLOWERS} → 링크(수익화) 금지 · 일상글로`,
    };
  }
  const ratio = await linkRatioBlock(accountId);
  if (ratio) return { ok: false, median: null, reason: ratio };
  // 3주 중앙값은 최근 며칠의 붕괴를 못 잡음(2026-10-02 pikkseetem: 중앙값 295 "건강"인데 최근 14·13·6뷰) → 붕괴 먼저 배제.
  if (await isCollapsedAccount(accountId)) {
    return { ok: false, median: null, reason: `도달 붕괴 (최근 ${COLLAPSE_SAMPLE}건 모두 ${COLLAPSE_MAX}뷰 미만) → 링크 금지 · 휴식 권장` };
  }
  const stats = await feedReachStats(accountId);
  if (stats == null) {
    const ok = (followersCount ?? 0) > FOLLOWER_FALLBACK;
    return {
      ok,
      median: null,
      reason: ok
        ? `도달 이력 부족 → 팔로워 폴백(${followersCount}명 > ${FOLLOWER_FALLBACK})`
        : `도달 이력 부족 + 팔로워 ${followersCount ?? 0}명 ≤ ${FOLLOWER_FALLBACK}`,
    };
  }
  const ok = stats.median >= REACH_FLOOR || stats.max >= BREAKOUT_PROOF;
  return {
    ok,
    median: stats.median,
    reason: ok
      ? `건강 (중앙값 ${stats.median}뷰${stats.max >= BREAKOUT_PROOF ? ` · 최근 최대 ${stats.max}뷰 터짐` : ''})`
      : `피드 도달 눌림 (중앙값 ${stats.median}뷰 · 최대 ${stats.max}뷰 · 한 번도 못 터짐) → 일상글로 워밍업 권장`,
  };
}
