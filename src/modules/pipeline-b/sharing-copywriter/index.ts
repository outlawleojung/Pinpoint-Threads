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
 *   - **계정별 톤 차별화** (personaPrompt 에서 스하리 톤 힌트 추출 · 2026-10-30)
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
  // ★★ 2026-10-29: 훅 다양화 — 아침 루틴만 7개 → 카테고리 분산. 5계정 매일 돌려도 2주간 안 겹치게.
  // — 아침 루틴 (3개로 축소)
  { label: '출근 직후', query: '출근하자마자 벌써 집에 가고 싶다', ageOK: ALL_AGES },
  { label: '아침 커피', query: '커피 한 잔 들어가야 사람 됨', ageOK: ALL_AGES },
  { label: '스레드 습관', query: '일 시작 전에 스레드 한 바퀴는 돌아야 됨', ageOK: ALL_AGES },
  // — 가벼운 인사·소통 (신상 X)
  { label: '스친 인사', query: '오늘 첫 글 스친들 안녕 좋은 하루', ageOK: ALL_AGES },
  { label: '소통 제안', query: '심심한데 놀 사람 댓글 남겨봐', ageOK: ALL_AGES },
  // — 공감·질문형
  { label: '공감 질문', query: '나만 이래? 다들 이런 거 공감돼?', ageOK: ALL_AGES },
  { label: '고민 한마디', query: '요즘 고민 많은데 나만 그런 거 아니지', ageOK: ALL_AGES },
  // — 의지·에너지형
  { label: '오늘 다짐', query: '오늘은 진짜 할 일 다 끝내고 일찍 쉰다', ageOK: ALL_AGES },
  { label: '같이 힘내자', query: '다들 힘내자 오늘도 한 걸음씩', ageOK: ALL_AGES },
  // — 유머·가벼운 잡담
  { label: '한마디 잡담', query: '갑자기 생각난 건데 별거 아닌데 웃김', ageOK: ALL_AGES },
  { label: '혼잣말', query: '아무도 안 물어봤는데 그냥 하고 싶은 말', ageOK: ALL_AGES },
  // — 감사·칭찬형
  { label: '스친 감사', query: '스친들 고마워 덕분에 오늘도 즐겁다', ageOK: ALL_AGES },
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
  body: z.string().min(4).max(80), // ★ 한 줄 40자 안쪽 (2026-10-13 사용자: 너무 길고 구구절절 → 전량 폐기)
});

/**
 * personaPrompt → 스하리용 간결 톤 힌트 한 줄.
 * 쇼핑·일상글용 페르소나가 "20대 여성 …" 같은 식이면 핵심 톤만 추출.
 * 신상(직업·나이·지역) 자체는 스하리 본문에 쓰면 안 되지만, 말투(반말·존댓말·이모지 빈도·에너지)는 구분 가능.
 */
function extractSharingToneHint(personaPrompt: string): string {
  const p = personaPrompt.trim();
  if (!p) return '자연스럽고 가벼운 반말';
  const hints: string[] = [];
  if (/솔직|직설|쿨/.test(p)) hints.push('쿨하고 직설적');
  if (/따뜻|다정|상냥|부드/.test(p)) hints.push('따뜻하고 다정한');
  if (/유머|웃|재밌|ㅋ/.test(p)) hints.push('유머러스한');
  if (/차분|담백|조용|깔끔/.test(p)) hints.push('담백하고 차분한');
  if (/활발|에너지|밝|텐션/.test(p)) hints.push('밝고 에너지 넘치는');
  if (/20대/.test(p)) hints.push('20대 말투');
  if (/30대/.test(p)) hints.push('30대 말투');
  if (/남성|남자/.test(p)) hints.push('남성 화자');
  if (/여성|여자/.test(p)) hints.push('여성 화자');
  return hints.length > 0 ? hints.join(' · ') : p.slice(0, 40);
}

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

const SYSTEM_PROMPT = `한국 Threads "스하리1000명프로젝트" 태그에 올릴 스하리 글을 쓴다. (2026-10-14 벤치마킹 방식)

방법: 사용자 메시지의 **벤치마크 글(실제로 반응 좋았던 스하리)**의 리듬·요청 방식을 참고해 **깔끔·간략·담백한 인사 한 줄**로 쓴다. (2026-10-18 사용자: 부탁·하소연형은 "구걸하는 듯" → 전량 폐기)
- 톤: 자연스럽고 담백하게. 오글거리거나 과장하지 마라("미치게 달려볼게💪🔥", "의리 반하리 무조건 감!!" 같은 건 X). 실제 사람이 편하게 쓴 것처럼. 가벼운 부탁("같이 하자", "놀러 와")은 OK, 하소연·구걸조("혼자 한계", "제발 도와줘")나 억지 텐션은 금지.
- 반말 위주(스레드 기본 말투). 존댓말은 되도록 쓰지 마라.
- 벤치마크 작성자의 취미·관심사·상황(그림·운동·육아 등)은 가져오지 마라 — 우리 계정 얘기가 아니다.
- 벤치마크의 오타·변형 표기("스와릿", "ㅂㅎㄹ", "쓰레드" 등)는 따라 쓰지 말고 "스하리/반하리/스레드"로.
- 좋은 예 (각각 다른 톤 — 매번 다른 각도를 써라):
  · 인사형: "스친 구함🙌 스하리 남기면 반하리 감"
  · 공감형: "나만 이래..? 댓글 달아줘 반하리 갈게"
  · 유머형: "할 일은 많은데 스레드부터 켬ㅋㅋ 스하리 하자"
  · 감사형: "스친들 덕분에 스레드 재밌다🍀 소통해요"
  · 에너지형: "오늘도 가보자💪 스하리 남기면 바로 감"
  · 질문형: "다들 아침에 뭐 해? 댓글 남겨봐 반하리 감"
- 벤치마크 글의 **톤·길이**를 참고하되, 매번 **위 6가지 중 다른 각도**로 써라. 문장 통째 복사 금지 — 표현을 바꿔 새 글로.
- 스하리 요청(스하리=반하리, 반하리 무조건 갈게, 도와줘 등)은 **반드시** 포함.
- 길이: 벤치마크보다 짧게, **60자 안쪽**. 구구절절 X.
- 숫자(팔로워 수)는 아래 "이 계정 사실"과 맞을 때만. "스레드 처음/오늘 시작/첫 계정" 같은 계정 나이 주장 금지.
- 이 글은 아침 8~9시대 발행 → 요일·날짜·시각·밤·퇴근·날씨·계절 표현 금지.
- 신상(자녀·직업·나이·지역·가게) 금지. 다른 계정 @·상품·링크 금지. 첨부 사진·영상 얘기 금지.
- 반말, ㅋㅋ·이모지 자연스럽게.
- ★ **계정 톤 지시**: "이 계정 톤" 에 적힌 말투를 반드시 따라라. 4개 계정이 매일 똑같은 패턴으로 쓰면 안 된다. 쿨한 계정은 쿨하게, 다정한 계정은 다정하게 — 각자 다른 사람이 쓴 것처럼.

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

  // 벤치마크 1개를 계정·variant 별로 회전 선택 → 그 글을 각색 (2026-10-14 사용자 "벤치마킹 하라고")
  const primary = benchmarks.length > 0 ? benchmarks[variantIndex % benchmarks.length]! : null;
  const toneHint = extractSharingToneHint(context.personaPrompt);
  const userPrompt = [
    `== 벤치마크 글 (댓글 ${primary?.likesCount ?? 0}) ==`,
    primary ? `"""\n${primary.text.slice(0, 220)}\n"""` : '(없음 — 스하리=반하리 요청형 한 줄로)',
    `== 이 계정 사실 == 팔로워 ${context.followersCount}명 · 계정 나이 ${context.accountAgeDays ?? '미확인'}일`,
    `== 이 계정 톤 == ${toneHint}`,
    ...(recentBodies.length > 0 ? ['최근 우리 글(같은 문장 반복 금지):', ...recentBodies.slice(0, 6).map((b) => `- ${b.replace(/\n/g, ' ').slice(0, 50)}`)] : []),
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
    .replace(/#[^\s#]+/g, '') // 본문 해시태그 전부 제거 (태그는 topic_tag 로만 · 벤치마크 따라 "#소통" 붙는 것 방지 · 2026-10-14)
    .replace(/#?\s*스하리\s*1000\s*명\s*프로젝트/g, '') // "#스하리1000명프로젝트" / "스하리 1000명 프로젝트" 등 변형 포함
    .replace(/[ \t]{2,}/g, ' ') // 제거 후 남은 이중 공백
    .replace(/^[ \t]+/gm, '') // 줄 앞 공백 (문구가 줄 첫머리에 있던 경우)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const hit = FORBIDDEN_TERMS.find((t) => cleaned.includes(t));
  if (hit) throw new SharingBlacklistError(hit, cleaned, false); // 금지어 = 하드
  const patHit = FORBIDDEN_PATTERNS.find((p) => p.re.test(cleaned));
  // 반복 방지 템플릿만 소프트(재시도 소진 시 수용) · 시간·요일·날씨 등 사실/정책 위반은 하드(절대 수용 X · 2026-10-14)
  if (patHit) throw new SharingBlacklistError(patHit.label, cleaned, !/시간|요일|날씨|계절/.test(patHit.label));
  // 유사도 검사 (2026-10-14): ① 벤치마크 거의 베낌 ② 다른 계정 최근 스하리와 비슷(같은 주인 신호) → 재생성
  {
    const grams = (t: string) => {
      const x = t.replace(/[\s\p{P}\p{S}ㅋㅎㅠㅜ]/gu, '');
      const g = new Set<string>();
      for (let i = 0; i < x.length - 1; i++) g.add(x.slice(i, i + 2));
      return g;
    };
    const sim = (a: string, b: string) => {
      const A = grams(a), B = grams(b);
      if (!A.size || !B.size) return 0;
      let n = 0;
      for (const g of A) if (B.has(g)) n++;
      return n / Math.min(A.size, B.size);
    };
    if (primary && sim(cleaned, primary.text) >= 0.6) throw new SharingBlacklistError('벤치마크 베낌', cleaned, false);
    const near = recentBodies.find((r) => sim(cleaned, r) >= 0.65);
    if (near) throw new SharingBlacklistError('최근 우리 스하리와 비슷', cleaned, false);
  }
  // 스하리 요청 필수 (2026-10-14 사용자: 요청 없는 한마디는 "스하리 글이 아님")
  if (!/스하리|반하리|맞팔|반사/.test(cleaned)) throw new SharingBlacklistError('스하리 요청 없음', cleaned, false);

  // 비마일스톤 훅인데 "N 넘고싶어/몇 명 남았어" 숫자 목표가 새면 소프트 재시도 (전 계정 숫자 수렴 방지).
  // 숫자는 실제 팔로워 기준 사실일 때만 · 계정 나이 주장 금지 (벤치마크가 숫자형·신생형이어도)
  {
    const { falseFollowerClaim, NEW_ACCOUNT_CLAIM } = await import('../sharing-repost.js');
    if (falseFollowerClaim(cleaned, context.followersCount)) throw new SharingBlacklistError('팔로워 숫자 거짓', cleaned, false);
    if (NEW_ACCOUNT_CLAIM.test(cleaned) || /스레드\s*처음|오늘\s*시작|첫\s*계정|입문/.test(cleaned)) throw new SharingBlacklistError('계정 나이 주장', cleaned, false);
  }

  return cleaned;
}

export class SharingBlacklistError extends Error {
  constructor(public term: string, public body: string, public soft = false) {
    super(`SHARING body contains forbidden ${soft ? 'pattern' : 'term'} "${term}": ${body.slice(0, 100)}`);
    this.name = 'SharingBlacklistError';
  }
}

const MAX_RETRY = 4;
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
/**
 * 스하리 패턴 분류 — 같은 패턴 벤치마크끼리 수렴 방지.
 * "의리·반하리" 패턴만 상위 12개를 독점하면 LLM 출력이 전부 같아지므로
 * 패턴별 최대 CAP 개로 제한하고 나머지는 다른 유형으로 채운다.
 */
type SharingPattern = 'loyalty' | 'milestone' | 'greeting' | 'daily_moment' | 'question' | 'energy' | 'other';
const PATTERN_CAP = 3; // 패턴당 최대 벤치마크 수

function classifySharingPattern(text: string): SharingPattern {
  const t = text.replace(/\s+/g, ' ');
  if (/의리|뒷삭|반하리.*무조건|무조건.*반하리|진짜.*바로|1분.*컷|100%/.test(t)) return 'loyalty';
  if (/\d+\s*명|넘고\s*싶|남았|채우|목표|달성/.test(t)) return 'milestone';
  if (/안녕|나는|시작했|처음|입문|자기소개/.test(t)) return 'greeting';
  if (/출근|퇴근|커피|피곤|배고|심심|월요일|아침/.test(t)) return 'daily_moment';
  if (/\?|맞아|어려운|힘든|왜.*이렇|진짜야/.test(t)) return 'question';
  if (/달리자|화이팅|가보자|🔥|💪|파이팅|가즈아/.test(t)) return 'energy';
  return 'other';
}

async function loadTrendingSharingBenchmarks(days: number, poolSize: number): Promise<SimilarBenchmark[]> {
  try {
    const since = new Date(Date.now() - days * 864e5);
    const recent = await prisma.benchmarkPost.findMany({
      where: { contentType: 'SHARING', collectedAt: { gte: since }, text: { not: '' } },
      orderBy: { collectedAt: 'desc' },
      take: 300,
      select: { id: true, sourceHandle: true, text: true, likesCount: true, repliesCount: true, viralFactors: true },
    });
    const scored = recent
      .map((r) => ({ ...r, score: r.repliesCount * 3 + r.likesCount, pattern: classifySharingPattern(r.text) }))
      .sort((a, b) => b.score - a.score);

    // 패턴별 CAP 적용: 같은 패턴이 풀을 독점하지 않게
    const patternCount = new Map<SharingPattern, number>();
    const diverse: typeof scored = [];
    const overflow: typeof scored = []; // CAP 초과분 (풀이 부족하면 여기서 보충)
    for (const r of scored) {
      const cnt = patternCount.get(r.pattern) ?? 0;
      if (cnt < PATTERN_CAP) {
        diverse.push(r);
        patternCount.set(r.pattern, cnt + 1);
      } else {
        overflow.push(r);
      }
      if (diverse.length >= poolSize) break;
    }
    // 풀이 부족하면 overflow 에서 보충 (다양성보다 빈 슬롯 방지)
    while (diverse.length < poolSize && overflow.length > 0) {
      diverse.push(overflow.shift()!);
    }

    const patternSummary = Object.fromEntries([...patternCount.entries()]);
    logger.info({ poolSize: diverse.length, patterns: patternSummary }, 'sharing benchmark pool (diversity-filtered)');

    return diverse.map((r) => ({
      id: r.id,
      sourceHandle: r.sourceHandle,
      text: r.text,
      likesCount: r.repliesCount ?? r.likesCount,
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
