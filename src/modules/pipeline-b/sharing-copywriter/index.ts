import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { type SimilarBenchmark } from '../../shared/source-collector/embedder.js';
import { getAccountContext, type AccountContext } from './follower-sync.js';
import { PostKind, PostState } from '@prisma/client';

/**
 * Pipeline B 스하리 각색 카피라이터.
 *
 * 원칙:
 *   - **계정 페르소나 무관** (스하리 = 소통 요청, 정체성과 별개)
 *   - **RAG 기반 각색** (pgvector · SHARING 벤치마크 풀 유사도 검색)
 *   - **계정 실 팔로워 수 기반** (허구 X, 구간에 맞는 표현만)
 *   - **훅 유형 다양화**: variant 마다 다른 훅 유형 쿼리 → 다른 few-shot
 *   - **본문에 "팔로워" 단어 직접 노출 X** (스레드 문화 어휘: "스친", "1000까지", "100 넘음" 등)
 */

const HASHTAG = '#스하리1000명프로젝트';

/**
 * 훅 유형 · 각 훅은 어떤 계정 나이 구간에서 자연스러운지 지정.
 * 계정 나이 구간에 안 맞는 훅은 배정에서 제외 (예: "발견·감탄형"은 fresh 계정에만).
 */
import type { AgeBucket } from './follower-sync.js';

interface HookDef {
  label: string;
  query: string;
  ageOK: AgeBucket[];
}

const HOOK_QUERIES: HookDef[] = [
  {
    label: '진행형',
    query: '스하리 계속 진행 중 몇 달째 소통 요청',
    ageOK: ['fresh_under_7d', 'young_under_30d', 'settled_1to3m', 'mature_3m_plus', 'unknown'],
  },
  {
    label: '모집형',
    query: '혼자 하기 힘들어서 같이 할 사람 찾아요 리포 맞팔',
    ageOK: ['fresh_under_7d', 'young_under_30d', 'settled_1to3m', 'mature_3m_plus', 'unknown'],
  },
  {
    label: '질문형·자기폭로',
    query: '아직 스친 없어? 그게 나야 못 채운',
    ageOK: ['fresh_under_7d', 'young_under_30d', 'settled_1to3m', 'mature_3m_plus', 'unknown'],
  },
  {
    label: '겸손 목표형',
    query: '100명이라도 좋겠다 욕심 안 부림 천천히',
    ageOK: ['fresh_under_7d', 'young_under_30d', 'settled_1to3m', 'mature_3m_plus', 'unknown'],
  },
  {
    label: 'N일차 (초기)',
    query: '스하리 프로젝트 2일차 3일차 시작한 지 얼마 안 됨',
    ageOK: ['fresh_under_7d', 'young_under_30d'], // 실제 최근 시작한 계정만
  },
  {
    label: '발견·감탄형',
    query: '방금 시작했는데 이 태그 신기하다 처음 알았음',
    ageOK: ['fresh_under_7d', 'young_under_30d'], // 이제 막 알았다는 뉘앙스 · fresh only
  },
  {
    label: '오래 하는 중',
    query: '몇 달째 꾸준히 하는데 아직 여기 정체 중',
    ageOK: ['settled_1to3m', 'mature_3m_plus'], // 오래 됐다는 뉘앙스 · mature only
  },
];

/** 본문 blacklist. 노출 시 재생성. */
const FORBIDDEN_TERMS = [
  '팔로워',   // 스레드 문화 어휘 아님 → "스친", "N명" 형태로만
  '팔로워수', '팔로워 늘리', 'follower',
];

/**
 * 금지 오프너·템플릿 패턴 (코드 강제 · 노출 시 재생성).
 * 프롬프트로만 막던 "몇 달째 하는 중인데 아직 N도 못 채움" 계열이 5계정 매일 똑같이 나와서 정규식으로 차단.
 */
//   "몇 달째" 자체는 성숙 계정엔 사실이라 허용. 5계정 매일 반복되던 **정확한 조합 템플릿만** 차단.
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // "몇 달째 … 아직 N도 못 채움/안 됨" whine 오프너 (반복 주범)
  { re: /몇\s*달째[\s\S]{0,30}(아직|겨우)[\s\S]{0,12}(못\s*채|안\s*(됨|돼|되))/, label: '몇달째-아직못채움-템플릿' },
];

const BodyResultSchema = z.object({
  body: z.string().min(30).max(300),
});

export interface SharingCopyInput {
  accountId: string;
  variantCount?: number;
  /** 계정 간 훅 다양화 offset. 여러 계정 순회 시 각 계정마다 다른 훅 배정. */
  hookOffset?: number;
}

export interface SharingCopyResult {
  accountId: string;
  handle: string;
  followersCount: number;
  followerBucket: string;
  variants: Array<{
    body: string;
    hookLabel: string;
    referencesUsed: Array<{ id: string; sourceHandle: string; repliesCount: number }>;
  }>;
}

const SYSTEM_PROMPT = `너는 한국 Threads "스하리1000명프로젝트" 해시태그 게시글을 각색하는 도구다.

역할: **각색가**. 아래 실제 스하리 벤치마크의 훅·리듬·정서를 재활용해 새 스하리 글 하나를 만들어라.

⚠️ 절대 규칙 (하나라도 어기면 실패):
- **본문 마지막 줄에 반드시 ${HASHTAG} 를 넣는다.**
- 다른 계정 handle(@…) 언급 절대 금지 (CIB 위반).
- 딥링크·쇼핑 광고·상품 언급 절대 금지.
- **"팔로워", "팔로워수", "팔로워 늘리는" 같은 단어 절대 사용 금지.**
  스레드 문화에서 안 씀. 대신 "스친", "N명 못 채움", "1000까지" 같은 마일스톤 숫자·문화 어휘 사용.
- 벤치마크의 **문장·수치를 그대로 복사하지 마라.**
  예: 벤치마크가 "3일차"면 "5일차" 같은 실제 계정 상태와 안 맞는 숫자 X → 그냥 "이제 막 시작" 정도로 각색.
- 존댓말 X (스레드 반말 기본).
- 신상(자녀·직업·나이·구체 취미) 노출 절대 X.

⚠️ 팔로워·계정 나이 언급 규칙 (실 계정 상황과 맞아야 함):
- 아래 "이 계정 현재 상황" 의 실제 값을 어투·표현 판정용으로만 사용. 본문에 원시 숫자 노출 X.
- 팔로워 관련: 구간 표현만 사용 (예: "아직 100도 안 됨", "이제 300 가는 중")
  · 언급 목표 수치는 실 팔로워보다 크되 다음 마일스톤 이내
  · 숫자 언급이 어색하면 그냥 "천천히 늘려보자" 로 대체
- **계정 나이 관련: 실제 나이 구간에 맞는 표현만.**
  · "스린이 · 이제 막 시작 · N일차" 은 계정 나이 7일 미만에만 허용
  · "몇 달째 · 오래 · 꾸준히 해왔는데" 는 3개월 이상 계정에만 허용
  · 나이·팔로워 관련 표현이 실 상황과 맞지 않으면 아예 언급하지 마

⚠️ 절대 금지 오프너 (템플릿화 방지):
- "몇 달째 (꾸준히) 하는 중인데 아직 N도 (못 채움/안 됨) ㅋㅋ" 계열 오프너 금지
- "팔로워 늘리는 거 [쉽지 않네/어렵네]" 계열 오프너 금지
- 위 패턴은 이미 5계정 다 같은 카피 만들어냄. 절대 안 됨.
- 대신 훅 유형(N일차/모집/질문/겸손/발견)에서 지시한 대로 개성 있는 오프너로 시작.

훅 유형별 오프너 예시 (참고):
- N일차 진행형: "스하리 프로젝트 N일차야" 처럼 진행 상태 선언
- 모집형: "혼자 힘드니까 같이 할 사람 구해!" 처럼 명확한 콜
- 질문형: "○○인 스친 있어? 그게 나야" 처럼 질문 던지고 자기폭로
- 겸손형: "1000명 그런거 안 바래, 100만 채워도 좋겠다" 처럼 낮은 목표
- 발견·감탄형: "이 해시태그 신기하네 다들 이렇게 하는구나?" 처럼 발견 뉘앙스

⚠️ 훅 유형 강제:
사용자 프롬프트에 "이번 variant 훅 유형" 지시가 들어감. **그 훅 유형 그대로 살려서 각색해라.**
벤치마크의 훅 개성(N일차·질문형·모집형·겸손형·발견형)을 반드시 재현.

톤:
- 짧고 리드미컬. 2~4줄, 40~150자 (해시태그 포함 200자 이내).
- 이모지 문장 끝 1~2개.
- LLM 창작 은유·억지 비유 X.
- 처음 본 사람도 즉시 이해되는 문장.

출력 포맷:
JSON만. { "body": "여기에 본문 + 마지막 줄 해시태그" }`;

async function generateOne(
  context: AccountContext,
  hook: { label: string; query: string },
  benchmarks: SimilarBenchmark[],
  variantIndex: number,
  recentBodies: string[] = [],
): Promise<string> {
  const refBlock =
    benchmarks.length > 0
      ? benchmarks
          .map(
            (b, i) =>
              `${i + 1}. [replies ${b.likesCount}]\n"""\n${b.text.slice(0, 400)}\n"""`,
          )
          .join('\n\n')
      : '(유사 벤치마크 없음. 훅 유형 지시만 따라 각색.)';

  const ageLabel = context.accountAgeDays == null
    ? '미확인'
    : `${context.accountAgeDays}일 (${context.accountAgeBucket})`;

  const userPrompt = [
    '== 이 계정 현재 상황 (사실 · 본문에 원시 숫자 노출 X) ==',
    `- 팔로워 구간: ${context.followerBucket} (실측 ${context.followersCount}명)`,
    `  허용 표현: ${context.followerHints.join(' / ')}`,
    `- 계정 나이: ${ageLabel}`,
    `  ${context.ageHints.join('\n  ')}`,
    '',
    `== 이번 variant 훅 유형: ${hook.label} ==`,
    `이 유형의 개성을 살려서 각색해라.`,
    '',
    '== 참고 스하리 벤치마크 (훅·리듬만 흡수, 문장·수치 복사 X) ==',
    refBlock,
    ...(recentBodies.length > 0
      ? [
          '',
          '== ⛔ 최근 이미 쓴 스하리 글 (오프너·구조·표현 절대 반복 X · 완전히 다른 각도로) ==',
          ...recentBodies.slice(0, 10).map((b, i) => `${i + 1}. "${b.replace(/\n/g, ' ').slice(0, 80)}"`),
          '위와 다른 오프너·다른 문장 구조로 써라. 특히 "몇 달째", "아직 N도 못 채움" 류는 절대 금지.',
        ]
      : []),
    '',
    `variant=${variantIndex}. 위 훅 유형·벤치마크 개성 + 실 계정 상황(팔로워 구간·나이)에 맞는 표현만 사용해 스하리 글 하나 각색.`,
    `마지막 줄 ${HASHTAG} 포함. JSON 만 반환.`,
  ].join('\n');

  const response = await llm().complete({
    tier: 'main',
    system: SYSTEM_PROMPT,
    userParts: [{ type: 'text', text: userPrompt }],
    maxOutputTokens: 700,
    temperature: 0.9 + variantIndex * 0.03,
    jsonMode: true,
    jsonSchema: {
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
    },
  });

  const parsed = extractJson(response.text);
  const { body } = BodyResultSchema.parse(parsed);
  const withHash = body.includes(HASHTAG) ? body : `${body.trimEnd()}\n${HASHTAG}`;

  const hit = FORBIDDEN_TERMS.find((t) => withHash.includes(t));
  if (hit) throw new SharingBlacklistError(hit, withHash, false); // 금지어 = 하드
  const patHit = FORBIDDEN_PATTERNS.find((p) => p.re.test(withHash));
  if (patHit) throw new SharingBlacklistError(patHit.label, withHash, true); // 템플릿 패턴 = 소프트

  return withHash;
}

export class SharingBlacklistError extends Error {
  constructor(public term: string, public body: string, public soft = false) {
    super(`SHARING body contains forbidden ${soft ? 'pattern' : 'term'} "${term}": ${body.slice(0, 100)}`);
    this.name = 'SharingBlacklistError';
  }
}

const MAX_RETRY = 2;
async function generateOneWithRetry(
  context: AccountContext,
  hook: { label: string; query: string },
  benchmarks: SimilarBenchmark[],
  variantIndex: number,
  recentBodies: string[] = [],
): Promise<string> {
  let lastErr: Error | null = null;
  let lastSoftBody: string | null = null; // 소프트 패턴 위반이지만 최종 fallback 으로 쓸 본문
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return await generateOne(context, hook, benchmarks, variantIndex + attempt * 10, recentBodies);
    } catch (err) {
      lastErr = err as Error;
      if (err instanceof SharingBlacklistError) {
        logger.warn({ term: err.term, soft: err.soft, attempt, variantIndex, hook: hook.label }, 'blacklist hit');
        if (err.soft) lastSoftBody = err.body; // 템플릿 패턴 = 소프트 → 최종 시도까지 실패하면 이거라도 씀
        continue;
      }
      // JSON 잘림·API 일시 오류 등도 재시도 (기존엔 즉시 throw 라 일회성 오류에 계정 전체 실패했음)
      logger.warn({ err, attempt, variantIndex, hook: hook.label }, 'sharing generation transient error → retry');
    }
  }
  // 소프트 패턴만 계속 걸렸으면 아예 실패시키지 말고 마지막 본문 채택 (다양성 < 발행 자체)
  if (lastSoftBody) {
    logger.warn({ variantIndex, hook: hook.label }, 'soft-pattern 재시도 소진 → 마지막 본문 수용');
    return lastSoftBody;
  }
  throw lastErr ?? new Error('sharing generation failed');
}

/**
 * 스하리 카피 생성.
 *   - variant 마다 다른 훅 유형 (rotation)
 *   - 각 유형에 맞는 pgvector 유사도 검색 → 다른 few-shot
 *   - 계정 실 팔로워 수 컨텍스트로 어투·구간 결정
 */
export async function generateSharingCopy(
  input: SharingCopyInput,
): Promise<SharingCopyResult> {
  const variantCount = input.variantCount ?? 1;

  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { id: true, handle: true },
  });

  const context = await getAccountContext(input.accountId);

  // 최근 7일 스하리 본문 (전 계정) → 반복 회피용. 같은 오프너·구조 재생성 방지.
  const recentBodies = await loadRecentSharingBodies(20);

  // 계정 나이 구간에 맞는 훅만 필터
  const eligibleHooks = HOOK_QUERIES.filter((h) => h.ageOK.includes(context.accountAgeBucket));
  if (eligibleHooks.length === 0) {
    throw new Error(`No eligible hooks for age bucket ${context.accountAgeBucket}`);
  }

  // ✅ 트렌드 반영: 유사도(옛 고참여 글)로 뽑지 않고 **최근 수집·게시된 스하리 글** 을 few-shot 으로.
  //    "예전 조회수 높은 글만 반복" 방지 → 지금 스하리 태그에서 도는 최신 흐름을 각색.
  const trendPool = await loadTrendingSharingBenchmarks(7, 30);

  const variants: SharingCopyResult['variants'] = [];
  const offset = input.hookOffset ?? 0;
  for (let i = 0; i < variantCount; i++) {
    const hook = eligibleHooks[(i + offset) % eligibleHooks.length]!;

    // 최근 트렌드 풀에서 계정·날짜별로 다른 4개 회전 선택 (다양성)
    const benchmarks: SimilarBenchmark[] = rotatePick(trendPool, offset + i, 4);

    try {
      const body = await generateOneWithRetry(context, hook, benchmarks, i, recentBodies);
      variants.push({
        body,
        hookLabel: hook.label,
        referencesUsed: benchmarks.map((b) => ({
          id: b.id,
          sourceHandle: b.sourceHandle,
          repliesCount: b.likesCount,
        })),
      });
    } catch (err) {
      logger.warn({ err, variantIndex: i, hook: hook.label }, 'variant gave up after retries');
    }
  }

  logger.info(
    {
      accountId: account.id,
      handle: account.handle,
      followers: context.followersCount,
      followerBucket: context.followerBucket,
      accountAgeDays: context.accountAgeDays,
      accountAgeBucket: context.accountAgeBucket,
      variantsProduced: variants.length,
    },
    'sharing copy generated',
  );

  return {
    accountId: account.id,
    handle: account.handle,
    followersCount: context.followersCount,
    followerBucket: context.followerBucket,
    variants,
  };
}

/**
 * 최근 트렌드 스하리 벤치마크 풀 (유사도 X · 최신성 우선).
 *   - 목적: "예전 조회수 높은 글만 반복" 방지. 지금 스하리 태그에 도는 최신 흐름을 각색.
 *   - collectedAt 최근 N일 + 실게시 시각(publishedAt) 최신 우선. (수집 시 이미 repliesCount≥20 필터됨)
 */
async function loadTrendingSharingBenchmarks(days: number, poolSize: number): Promise<SimilarBenchmark[]> {
  try {
    const since = new Date(Date.now() - days * 864e5);
    const rows = await prisma.benchmarkPost.findMany({
      where: { contentType: 'SHARING', collectedAt: { gte: since }, text: { not: '' } },
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { collectedAt: 'desc' }],
      take: poolSize,
      select: { id: true, sourceHandle: true, text: true, likesCount: true, repliesCount: true, viralFactors: true },
    });
    return rows.map((r) => ({
      id: r.id,
      sourceHandle: r.sourceHandle,
      text: r.text,
      likesCount: r.repliesCount ?? r.likesCount, // 스하리 참여 = 댓글 수
      distance: 0,
      viralFactors: (r.viralFactors as Record<string, unknown> | null) ?? null,
    }));
  } catch (err) {
    logger.warn({ err }, 'loadTrendingSharingBenchmarks failed');
    return [];
  }
}

/** 최근 7일 스하리 본문 (전 계정 · 리젝/실패 제외) — 반복 회피용. */
async function loadRecentSharingBodies(limit: number): Promise<string[]> {
  try {
    const since = new Date(Date.now() - 7 * 864e5);
    const posts = await prisma.post.findMany({
      where: {
        kind: PostKind.SHARING,
        createdAt: { gte: since },
        generatedBody: { not: null },
        state: { notIn: [PostState.REJECTED, PostState.FAILED] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { generatedBody: true },
    });
    return posts.map((p) => p.generatedBody).filter((b): b is string => !!b);
  } catch {
    return [];
  }
}

/** 풀에서 offset 부터 n개를 회전 선택 (계정·날짜별 다른 few-shot). */
function rotatePick<T>(pool: T[], offset: number, n: number): T[] {
  if (pool.length <= n) return pool;
  const start = ((offset % pool.length) + pool.length) % pool.length;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]!);
  return out;
}

function extractJson(raw: string): unknown {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const s = stripped.indexOf('{');
    const e = stripped.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) {
      try {
        return JSON.parse(stripped.slice(s, e + 1));
      } catch {
        /* fallthrough to salvage */
      }
    }
    // 잘린 응답 salvage: "body" 값만이라도 추출 (닫는 따옴표·괄호 없어도)
    const m = stripped.match(/"body"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (m && m[1] && m[1].trim().length >= 20) {
      return { body: m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() };
    }
    throw new Error(`no JSON in response: ${stripped.slice(0, 200)}`);
  }
}
