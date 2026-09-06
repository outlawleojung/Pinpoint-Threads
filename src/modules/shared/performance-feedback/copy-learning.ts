import { PostKind } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { llm } from '../../../infra/llm/index.js';
import { scoreAllPublished, type ScoredPost } from './scorer.js';

/**
 * Copy Learning — 성과 피드백 루프 유닛 ②.
 *
 * winner 게시글에서 **구조적 성공 요인만** 추출해 카피라이터 힌트로.
 *
 * ⚠️ 표면 문장 복제 금지 (spec §3.3): 현재 스하리 winner 는 옛 "몇 달째" 템플릿 글이라,
 *    본문을 그대로 few-shot 하면 제거한 템플릿을 재학습시킴. → 추상 요인(훅·리듬·감정·길이)만.
 */

export interface SharingLearnings {
  /** winner 대비 loser 로 뽑은 구조적 성공 요인 (문장 인용 X). */
  factors: string[];
  /** loser 오프너 회피 목록 (앞 구절). */
  avoidOpeners: string[];
}

const EMPTY: SharingLearnings = { factors: [], avoidOpeners: [] };

/** winner ≥ 이 수 미만이면 요인 추출 보류(신호 부족). */
const MIN_WINNERS = 2;

/** 배치 내 5계정이 같은 요인을 재추출하지 않게 TTL 캐시 (Haiku 호출 절감). */
const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: { at: number; value: SharingLearnings } | null = null;

async function fetchBodies(posts: ScoredPost[]): Promise<Array<{ score: number; body: string }>> {
  if (posts.length === 0) return [];
  const rows = await prisma.post.findMany({
    where: { id: { in: posts.map((p) => p.postId) } },
    select: { id: true, generatedBody: true },
  });
  const map = new Map(rows.map((r) => [r.id, r.generatedBody ?? '']));
  return posts.map((p) => ({ score: p.score, body: map.get(p.postId) ?? '' })).filter((x) => x.body);
}

/**
 * 스하리 성공 요인 추출. 배치당 1회 호출(계정 순회 전) 권장 — 결과를 generateOne 에 재사용.
 */
export async function getSharingLearnings(): Promise<SharingLearnings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const scored = await scoreAllPublished();
    const winners = scored.filter((s) => s.kind === PostKind.SHARING && s.rank === 'winner');
    const losers = scored.filter((s) => s.kind === PostKind.SHARING && s.rank === 'loser');
    if (winners.length < MIN_WINNERS) {
      logger.info({ winners: winners.length }, 'copy-learning: 스하리 winner 부족 → 요인 추출 보류');
      cache = { at: Date.now(), value: EMPTY };
      return EMPTY;
    }

    const winBodies = await fetchBodies(winners);
    const loseBodies = await fetchBodies(losers);
    if (winBodies.length === 0) return EMPTY;

    const avoidOpeners = loseBodies
      .map((x) => x.body.replace(/\n/g, ' ').trim().slice(0, 16))
      .filter((s) => s.length >= 4);

    const system = `너는 한국 Threads "스하리"(맞팔·소통 요청) 게시글의 성공 요인 분석기다.
아래 winner(반응 좋았던)와 loser(저조했던) 글을 비교해, winner 가 잘 된 이유를 **구조적 관점**에서만 뽑아라:
훅 유형 · 문장 리듬 · 감정 앵글 · 길이 · CTA(콜) 유무.

⚠️ 규칙:
- **구체적 문장·표현을 인용하지 마라.** 다음 카피 작성 지침이 될 추상 요인만.
- "몇 달째", "아직 N 못 채움" 같은 특정 템플릿 문구를 요인으로 만들지 마라(그건 이미 금지).
- 2~3개, 각 요인은 한 줄. 실행 가능한 지침형("~하라"보다 "~일 때 반응 좋음").

JSON 만: { "factors": ["...", "..."] }`;

    const user = [
      '=== winner (반응 좋음) ===',
      ...winBodies.map((x, i) => `${i + 1}. [참여합 ${x.score}] ${x.body.replace(/\n/g, ' ').slice(0, 120)}`),
      '',
      '=== loser (저조) ===',
      ...loseBodies.map((x, i) => `${i + 1}. [참여합 ${x.score}] ${x.body.replace(/\n/g, ' ').slice(0, 120)}`),
      '',
      '위 대비로 winner 의 구조적 성공 요인 2~3개를 JSON 으로.',
    ].join('\n');

    const res = await llm().complete({
      tier: 'fast',
      system,
      userParts: [{ type: 'text', text: user }],
      maxOutputTokens: 300,
      temperature: 0.2,
      jsonMode: true,
      jsonSchema: { type: 'object', properties: { factors: { type: 'array', items: { type: 'string' } } }, required: ['factors'] },
    });

    let factors: string[] = [];
    try {
      const parsed = JSON.parse(res.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim());
      if (Array.isArray(parsed.factors)) factors = parsed.factors.filter((f: unknown): f is string => typeof f === 'string').slice(0, 3);
    } catch {
      /* 파싱 실패 → 요인 없이 진행 */
    }
    logger.info({ winners: winners.length, factors, avoidOpeners: avoidOpeners.length }, 'copy-learning: 스하리 요인 추출');
    const value = { factors, avoidOpeners };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logger.warn({ err }, 'getSharingLearnings failed — 학습 없이 진행');
    return EMPTY;
  }
}
