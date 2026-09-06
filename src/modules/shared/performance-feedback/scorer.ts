import { prisma } from '../../../db/prisma.js';
import { PostKind, PostState } from '@prisma/client';

/**
 * Performance Scorer — 성과 피드백 루프 유닛 ①.
 *
 * PostInsightSnapshot(24h·72h) → 종류별·풀 전체 기준으로 winner/neutral/loser 분류.
 *
 * 설계 근거(실측 2026-09-06, docs/superpowers/specs/2026-09-06-performance-feedback-loop-design.md):
 *   - 쇼핑: 조회(리치)가 유일한 분리 신호. 좋아요·조회 무상관, 댓글·리포스트 ~0. → 조회 기준.
 *   - 스하리: 좋아요+댓글+리포스트가 일관 동반 상승 = 진짜 신호. → 합산 기준.
 *   - 계정별 표본 1~3개뿐 → 계정별 아님, **풀 전체(종류별)** 기준.
 *   - engagementScore(=좋아요/조회 rate)는 리치를 페널티(역방향)라 승자 신호로 안 씀.
 */

export type Rank = 'winner' | 'neutral' | 'loser';

export interface ScoredPost {
  postId: string;
  kind: PostKind;
  handle: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  replyViews: number | null;
  hoursAfterPublish: number;
  score: number;
  rank: Rank;
  basis: string;
}

/** 풀이 이 크기 미만이면 판정 보류(전원 neutral). */
export const MIN_POOL = 5;
/** 쇼핑 winner 절대 바닥. 배수 규칙과 AND. 댓글조회(~한자릿수)·본문조회 양쪽에 맞게 작게. */
export const SHOPPING_MIN_SCORE = 10;
/** 쇼핑 winner = 점수 ≥ 풀 중앙값 × 이 배수 (스케일 무관 상대 규칙). */
export const SHOPPING_WINNER_MULT = 5;
/** 상·하위 백분위 컷 (스하리 winner/loser · 쇼핑 loser). */
export const TOP_PCT = 0.7;
export const BOTTOM_PCT = 0.3;

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

interface RawPost {
  postId: string;
  kind: PostKind;
  handle: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  /** 고정 댓글(쿠팡 링크) 조회 = 쇼핑 클릭 게이트. null = 미수집(구 데이터) → 본문 조회 fallback. */
  replyViews: number | null;
  hoursAfterPublish: number;
}

/** 쇼핑 점수 = 댓글 조회(클릭 게이트) 우선, 없으면 본문 조회 fallback. */
function shoppingMetric(p: RawPost): { score: number; fromReply: boolean } {
  if (p.replyViews != null) return { score: p.replyViews, fromReply: true };
  return { score: p.views, fromReply: false };
}

/** 종류별 원시 성과 배열 → 분류. 순수 함수(테스트 대상). */
export function classifyPool(kind: PostKind, posts: RawPost[]): ScoredPost[] {
  const scoreOf = (p: RawPost) =>
    kind === PostKind.SHOPPING ? shoppingMetric(p).score : p.likes + p.replies + p.reposts;

  const withScore = posts.map((p) => ({ ...p, score: scoreOf(p) }));

  // 풀 부족 → 판정 보류
  if (withScore.length < MIN_POOL) {
    return withScore.map((p) => ({
      ...p,
      rank: 'neutral' as Rank,
      basis: `표본 부족(${withScore.length}<${MIN_POOL}) · 판정 보류`,
    }));
  }

  const scores = withScore.map((p) => p.score).sort((a, b) => a - b);
  const median = quantile(scores, 0.5);
  const pTop = quantile(scores, TOP_PCT);
  const pBottom = quantile(scores, BOTTOM_PCT);

  return withScore.map((p) => {
    let rank: Rank = 'neutral';
    let basis = '';
    if (kind === PostKind.SHOPPING) {
      const src = shoppingMetric(p).fromReply ? '댓글조회' : '본문조회(댓글미수집)';
      const thr = Math.max(SHOPPING_MIN_SCORE, median * SHOPPING_WINNER_MULT);
      if (p.score >= thr) {
        rank = 'winner';
        basis = `${src} ${p.score} ≥ max(${SHOPPING_MIN_SCORE}, 중앙값${median}×${SHOPPING_WINNER_MULT}=${median * SHOPPING_WINNER_MULT})`;
      } else if (p.score <= pBottom) {
        rank = 'loser';
        basis = `${src} ${p.score} ≤ 하위30%(${pBottom})`;
      } else {
        basis = `${src} ${p.score} · 중간(신호 미약)`;
      }
    } else {
      if (p.score >= pTop) {
        rank = 'winner';
        basis = `참여합 ${p.score} ≥ 상위30%(${pTop})`;
      } else if (p.score <= pBottom) {
        rank = 'loser';
        basis = `참여합 ${p.score} ≤ 하위30%(${pBottom})`;
      } else {
        basis = `참여합 ${p.score} · 중간`;
      }
    }
    return { ...p, rank, basis };
  });
}

/**
 * DB에서 PUBLISHED 게시글 스냅샷 로드 → 종류별 분류.
 * @param horizon 특정 시점(24·72)으로 채점. 미지정이면 최신 스냅샷(72h 우선).
 *   확산 판정("24h·72h 둘 다 winner")에 사용.
 */
export async function scoreAllPublished(horizon?: 24 | 72): Promise<ScoredPost[]> {
  const posts = await prisma.post.findMany({
    where: { state: PostState.PUBLISHED },
    select: {
      id: true,
      kind: true,
      account: { select: { handle: true } },
      insightSnapshots: {
        orderBy: { hoursAfterPublish: 'desc' },
        select: { hoursAfterPublish: true, views: true, likes: true, replies: true, reposts: true, replyViews: true },
      },
    },
  });

  const pickSnap = (snaps: { hoursAfterPublish: number; views: number; likes: number; replies: number; reposts: number; replyViews: number | null }[]) =>
    horizon ? snaps.find((s) => s.hoursAfterPublish === horizon) : snaps[0]; // snaps 는 desc 정렬 → [0]=최신

  const raws: RawPost[] = posts
    .map((p) => ({ p, s: pickSnap(p.insightSnapshots) }))
    .filter((x): x is { p: typeof x.p; s: NonNullable<typeof x.s> } => !!x.s)
    .map(({ p, s }) => {
      return {
        postId: p.id,
        kind: p.kind,
        handle: p.account?.handle ?? '?',
        views: s.views,
        likes: s.likes,
        replies: s.replies,
        reposts: s.reposts,
        replyViews: s.replyViews,
        hoursAfterPublish: s.hoursAfterPublish,
      };
    });

  const out: ScoredPost[] = [];
  for (const kind of [PostKind.SHOPPING, PostKind.SHARING, PostKind.DAILY]) {
    out.push(...classifyPool(kind, raws.filter((r) => r.kind === kind)));
  }
  return out;
}

/** 특정 종류의 winner 목록 (copy-learning 용). */
export async function getWinners(kind: PostKind): Promise<ScoredPost[]> {
  const all = await scoreAllPublished();
  return all.filter((p) => p.kind === kind && p.rank === 'winner');
}
