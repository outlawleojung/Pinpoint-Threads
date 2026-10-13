import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { type SimilarBenchmark } from '../../shared/source-collector/embedder.js';
import { getAccountContext, type AccountContext } from './follower-sync.js';
import { PostKind, PostState } from '@prisma/client';
import { getSharingLearnings, type SharingLearnings } from '../../shared/performance-feedback/copy-learning.js';

const NO_LEARNINGS: SharingLearnings = { factors: [], avoidOpeners: [] };

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

/**
 * 스하리 토픽 태그 — **본문 텍스트 금지**.
 * Threads `topic_tag` 파라미터로만 부착 → 게시물엔 태그로 붙지만 본문 글자엔 안 들어감 (사용자 방침).
 * (# 없이, ≤50자, 마침표·& 금지)
 */
export const SHARING_TOPIC_TAG = '스하리1000명프로젝트';

/**
 * 훅 유형 · 각 훅은 어떤 계정 나이 구간에서 자연스러운지 지정.
 * 계정 나이 구간에 안 맞는 훅은 배정에서 제외 (예: "발견·감탄형"은 fresh 계정에만).
 */
import type { AgeBucket } from './follower-sync.js';

interface HookDef {
  label: string;
  query: string;
  ageOK: AgeBucket[];
  /** true인 훅만 프롬프트에 현재 팔로워 숫자를 노출(마일스톤 언급용). 나머지는 숫자 없이 순수 에너지로. */
  milestone?: boolean;
}

const ALL_AGES: AgeBucket[] = ['fresh_under_7d', 'young_under_30d', 'settled_1to3m', 'mature_3m_plus', 'unknown'];

// ★ 실제 고참여 스하리 글(댓글 400~900)의 훅 패턴을 반영. 공통점 = "에너지 + 매번 다른 각도".
//   밍밍한 잡담 X · 신상(직업·자녀 등) 노출 X · 하지만 스하리 특유의 텐션은 그대로. 회전해서 매일 다른 훅.
//   ★ 숫자(마일스톤)는 milestone 훅에서만 — 안 그러면 전 계정이 "N 넘고싶어"로 또 수렴(숫자만 바뀜).
// ★ 톤을 다양하게 (에너지·웃김·담백·호기심). 전부 "달리자🔥"로 수렴하면 매일 똑같아 보인다(실측 2026-09-17).
//   하이에너지도 담백함도 섞여야 5계정·날짜 간 변주가 생긴다.
// ★★ 2026-10-07 실측 전환: 반응 좋은 최신 스하리(댓글 50~76·좋아요 173)는 **일상 한마디가 중심**
//   ("출근하기 싫은 날… 힘내자", "나지금 ㅁㅐ우 심심함.") + 스하리 요청은 끝에 한 줄 또는 생략.
//   우리 글은 "스하리 해줘/N명/반하리 갈게" 메타 얘기뿐이라 대부분 0~20뷰. → 훅 = 누구나 겪는 오늘의 한 순간.
//   신상(자녀·직업·나이·구체 취미) X · 첨부(남의 영상)를 내 것처럼 말하기 X("우리 강아지" X).
const HOOK_QUERIES: HookDef[] = [
  // ★ 스하리는 아침 8~9시대 발행 → 그 시간에 맞는 순간만 (2026-10-13 사용자: 기상 직후 글은 6~7시에나 어울림).
  { label: '출근 직후', query: '출근하자마자 벌써 집에 가고 싶다', ageOK: ALL_AGES },
  { label: '벌써 피곤', query: '아침인데 벌써 하루 다 산 기분', ageOK: ALL_AGES },
  { label: '아침 커피', query: '커피 한 잔 들어가야 사람 됨 아직 정신 못 차림', ageOK: ALL_AGES },
  { label: '아침 배고픔', query: '아침 거르고 나왔더니 벌써 배고프다', ageOK: ALL_AGES },
  // 날씨·계절 훅 제거 (2026-10-12 사용자): 다음 날 아침 발행이라 실제 날씨를 모름 → 틀릴 수 있음
  { label: '스레드 습관', query: '일 시작 전에 스레드 한 바퀴는 돌아야 됨', ageOK: ALL_AGES },
  { label: '오늘 다짐', query: '오늘은 진짜 할 일 다 끝내고 일찍 쉰다', ageOK: ALL_AGES },
  { label: '소소한 웃긴 일', query: '급하게 나왔더니 양말 짝짝이인 거 이제 봄', ageOK: ALL_AGES },
  { label: '심심함 한마디', query: '할 일 앞두고 괜히 딴짓하는 중 인사하고 갈 사람', ageOK: ALL_AGES },
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
  // "뒷삭 없이 반하리" 상투적 꼬리말 (13/15 반복) — 정확 조합만 차단, 다른 반하리 표현은 허용
  { re: /뒷삭\s*(한\s*번\s*)?없이\s*반하리/, label: '뒷삭없이반하리-상투구' },
  // "오래 굴린/붙잡은/해온 계정" 계정나이 상투 오프너 (13/15 반복)
  { re: /오래\s*(굴린|굴려온|붙잡[은고]|해온|해왔)/, label: '오래된계정-상투오프너' },
  // "알림 없는데 새로고침" 각도 — 반복 + 실측 저조(kle0 25뷰 · 2026-10-07)
  { re: /새로고침/, label: '새로고침-반복각도' },
  // 시각·시간대 — 스하리는 일상글 발행 직후 생성되지만 같은 계정 4h 간격으로 몇 시간 뒤 나감 (2026-10-12)
  { re: /\d{1,2}\s*시(?!간)|오후|저녁|새벽|밤|야식|잠이\s*안|잠\s*안\s*와|퇴근|눈\s*(?:뜨자마자|떠서|뜨면|뜨고)|일어나자마자|일어나서|알람|[월화수목금토일]요일|주말|불금|평일|어제/, label: '아침 발행에 안 맞는 시간·요일 표현' },
  // 날씨·계절 — 발행일 실제 날씨를 모름 (2026-10-12 사용자 "즉흥 발행 아니면 날씨 얘기 하지 마")
  { re: /날씨|추워|추운|춥다|쌀쌀|선선|더워|더운|덥다|비\s*(?:와|오|가\s*와|내)|눈\s*(?:와|오는|온다|내려)|장마|미세먼지|햇살|가을|겨울|여름|봄바람|바람\s*(?:불|차)/, label: '날씨·계절(발행일 날씨 모름)' },
];

const BodyResultSchema = z.object({
  body: z.string().min(4).max(40), // ★ 한 줄 40자 안쪽 (2026-10-13 사용자: 너무 길고 구구절절 → 전량 폐기)
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

const SYSTEM_PROMPT = `한국 Threads "스하리1000명프로젝트" 태그에 올릴 스하리 글 한 줄을 쓴다. (2026-10-13 간소화 · 비용 절감)

규칙:
- **한 줄, 25자 안쪽(최대 40자).** 구구절절 X — 아무도 안 읽는다.
- 중심은 누구나 겪는 일상 한마디. 스하리 요청은 붙여도 몇 글자("스하리 환영🙌") 또는 생략.
- 이 글은 **아침 8~9시대**(출근·등교 직후)에 올라간다 → 그 시간에 맞는 말만.
  ⛔ 눈 뜨자마자·알람·밤·새벽·야식·퇴근 · 요일·날짜·시각 · 날씨·계절 · 숫자·팔로워·계정 나이 · 신상(자녀·직업·나이)
- 반말, ㅋㅋ 가능, 이모지 0~1개. 다른 계정 @ 금지. 상품·링크 금지. 첨부 사진·영상 얘기 금지.
- 아래 참고 글은 말투·리듬만 흡수. 문장 복사 금지. 최근 우리 글과 같은 오프너 반복 금지.
반응 좋았던 예: "나지금 ㅁㅐ우 심심함." / "출근하자마자 집 가고 싶음ㅋㅋ"

JSON만: { "body": "..." }`;

/** 생성 시점의 한국 요일·시간대 (스하리 일상 한마디가 요일을 지어내지 않게). */
function nowKoContext(now = new Date()): string {
  const k = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][k.getDay()];
  const h = k.getHours();
  const part = h < 5 ? '새벽' : h < 11 ? '아침' : h < 14 ? '점심 무렵' : h < 18 ? '오후' : h < 22 ? '저녁' : '밤';
  return `${k.getMonth() + 1}월 ${k.getDate()}일 ${day} ${part}(${h}시)`;
}

async function generateOne(
  context: AccountContext,
  hook: { label: string; query: string; milestone?: boolean },
  benchmarks: SimilarBenchmark[],
  variantIndex: number,
  recentBodies: string[] = [],
  learnings: SharingLearnings = NO_LEARNINGS,
): Promise<string> {
  const refBlock =
    benchmarks.length > 0
      ? benchmarks
          .map(
            (b, i) =>
              `${i + 1}. [replies ${b.likesCount}]\n"""\n${b.text.slice(0, 120)}\n"""`,
          )
          .join('\n\n')
      : '(유사 벤치마크 없음. 훅 유형 지시만 따라 각색.)';

  const ageLabel = context.accountAgeDays == null
    ? '미확인'
    : `${context.accountAgeDays}일 (${context.accountAgeBucket})`;

  // 마일스톤 훅: 실제 스친 수 기준 "믿을 만한 다음 목표"만. 구간(bucket)만 주면 107명인데 "300 코앞" 같은 거짓이 나옴.
  const cur = context.followersCount;
  const nextMilestone = cur < 100 ? 100 : Math.ceil((cur + 1) / 100) * 100; // 107 → 200
  const gap = nextMilestone - cur;
  const closeToMilestone = gap <= 25; // 코앞이라 할 수 있는 거리

  const userPrompt = [
    `소재: ${hook.label} (예: "${hook.query}")`,
    '참고 글(말투만):',
    refBlock,
    ...(recentBodies.length > 0 ? ['최근 우리 글(오프너 반복 금지):', ...recentBodies.slice(0, 6).map((b) => `- ${b.replace(/\n/g, ' ').slice(0, 50)}`)] : []),
    `variant=${variantIndex}. JSON만.`,
  ].join('\n');

  const response = await llm().complete({
    tier: 'fast', // 한 줄 25자 문구 → Haiku 로 충분 (2026-10-13 사용자 "최대한 아껴")
    system: SYSTEM_PROMPT,
    // slice() 로 반쪽 잘린 이모지(lone surrogate) 제거 → Anthropic 'no low surrogate' 요청오류 방지
    userParts: [{ type: 'text', text: sanitizeForLlm(userPrompt) }],
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
  // "스하리1000명프로젝트"는 **본문 텍스트 금지** — 발행 시 topic_tag 로만 붙는다 (사용자 방침).
  //   LLM이 문장/해시태그로 넣는 경우가 있어 본문에서 문구(# 유무·띄어쓰기 변형)를 전부 제거.
  //   (단독 "스하리" 단어는 정상 어휘라 건드리지 않음)
  const cleaned = body
    .replace(/#?\s*스하리\s*1000\s*명\s*프로젝트/g, '') // "#스하리1000명프로젝트" / "스하리 1000명 프로젝트" 등 변형 포함
    .replace(/[ \t]{2,}/g, ' ') // 제거 후 남은 이중 공백
    .replace(/^[ \t]+/gm, '') // 줄 앞 공백 (문구가 줄 첫머리에 있던 경우)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const hit = FORBIDDEN_TERMS.find((t) => cleaned.includes(t));
  if (hit) throw new SharingBlacklistError(hit, cleaned, false); // 금지어 = 하드
  const patHit = FORBIDDEN_PATTERNS.find((p) => p.re.test(cleaned));
  if (patHit) throw new SharingBlacklistError(patHit.label, cleaned, true); // 템플릿 패턴 = 소프트

  // 비마일스톤 훅인데 "N 넘고싶어/몇 명 남았어" 숫자 목표가 새면 소프트 재시도 (전 계정 숫자 수렴 방지).
  if (!hook.milestone && /\d{2,4}\s*(명|넘|찍|까지|앞두|근처|언저리)/.test(cleaned)) {
    throw new SharingBlacklistError('비마일스톤-숫자목표누출', cleaned, true);
  }

  return cleaned;
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
  hook: { label: string; query: string; milestone?: boolean },
  benchmarks: SimilarBenchmark[],
  variantIndex: number,
  recentBodies: string[] = [],
  learnings: SharingLearnings = NO_LEARNINGS,
): Promise<string> {
  let lastErr: Error | null = null;
  let lastSoftBody: string | null = null; // 소프트 패턴 위반이지만 최종 fallback 으로 쓸 본문
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return await generateOne(context, hook, benchmarks, variantIndex + attempt * 10, recentBodies, learnings);
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

  // 성과 피드백: winner 구조 요인 + loser 오프너 회피 (유닛② copy-learning)
  const learnings = await getSharingLearnings();
  const avoidBodies = [...recentBodies, ...learnings.avoidOpeners];

  // 계정 나이 구간에 맞는 훅만 필터
  const eligibleHooks = HOOK_QUERIES.filter((h) => h.ageOK.includes(context.accountAgeBucket));
  if (eligibleHooks.length === 0) {
    throw new Error(`No eligible hooks for age bucket ${context.accountAgeBucket}`);
  }

  // ✅ 트렌드 반영: 유사도(옛 고참여 글)로 뽑지 않고 **최근 수집·게시된 스하리 글** 을 few-shot 으로.
  //    "예전 조회수 높은 글만 반복" 방지 → 지금 스하리 태그에서 도는 최신 흐름을 각색.
  const trendPool = await loadTrendingSharingBenchmarks(7, 12);

  const variants: SharingCopyResult['variants'] = [];
  const offset = input.hookOffset ?? 0;
  for (let i = 0; i < variantCount; i++) {
    const hook = eligibleHooks[(i + offset) % eligibleHooks.length]!;

    // 최근 트렌드 풀에서 계정·날짜별로 다른 4개 회전 선택 (다양성)
    const benchmarks: SimilarBenchmark[] = rotatePick(trendPool, offset + i, 4);

    try {
      const body = await generateOneWithRetry(context, hook, benchmarks, i, avoidBodies, learnings);
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
    // 반응 좋은 순 (2026-10-12 사용자 "반응 좋은 스하리 수집해서 활용"): 최근 수집분 중 댓글×3+좋아요 상위.
    const recent = await prisma.benchmarkPost.findMany({
      where: { contentType: 'SHARING', collectedAt: { gte: since }, text: { not: '' } },
      orderBy: { collectedAt: 'desc' },
      take: 300,
      select: { id: true, sourceHandle: true, text: true, likesCount: true, repliesCount: true, viralFactors: true },
    });
    const rows = recent
      .sort((a, b) => b.repliesCount * 3 + b.likesCount - (a.repliesCount * 3 + a.likesCount))
      .slice(0, poolSize);
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

/** slice 로 짝 잃은 서로게이트(반쪽 이모지) 제거 — LLM 요청 JSON 깨짐 방지. */
function sanitizeForLlm(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '') // 짝 없는 high surrogate
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ''); // 짝 없는 low surrogate
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
