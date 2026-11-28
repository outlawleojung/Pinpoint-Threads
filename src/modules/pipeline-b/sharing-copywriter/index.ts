import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { getAccountContext } from './follower-sync.js';
import { PostKind, PostState } from '@prisma/client';
import { llm } from '../../../infra/llm/index.js';

/**
 * Pipeline B 스하리 카피라이터 (2026-11-28 재개편).
 *
 * 2026-11-22 "오프너+꼬리 폐지, 공식 풀만" 전제는 벤치마크를 잘못 해석.
 * 실제 벤치마크 TOP (BenchmarkPost 1795건 조사, 좋아요 300+):
 *   - 1250♥: "휴게소에서 차키 주웠는데 혹시 잃어버린 스친 있니?" (상황 질문)
 *   - 977♥:  "스레드 시작한 지 얼마 안 됐거나 같이 성장할 친구가 필요하다면..." (초대·설명)
 *   - 918♥:  "진짜 친구들 오늘 나 무시당했자나..." (감정 토로)
 *   - 736♥:  "힝... 첫스레드 썼는데 아무도 안봐줘써🥺" (애교 호소)
 *   - 709♥:  "마흔다섯에 다시 신입사원 됐어..." (자기 스토리)
 *   - 669♥:  "스레드 우습게 본거 후회된다. 5개월 꾸준히..." (성공담)
 *
 * TOP은 전부 "자기 공개/상황/스토리 + 스친 요청" 조합.
 * "스하리 남기면 반하리 감" 단순 공식은 중위권 이하.
 *
 * 설계: Account.personaPrompt + 벤치마크 TOP few-shot + 최근 14일 recentBodies 회피 → LLM 생성.
 */

/**
 * 스하리 토픽 태그 — **본문 텍스트 금지**.
 * Threads `topic_tag` 파라미터로만 부착.
 */
export const SHARING_TOPIC_TAG = '스하리1000명프로젝트';

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

export class SharingBlacklistError extends Error {
  constructor(public term: string, public body: string, public soft = false) {
    super(`SHARING body contains forbidden ${soft ? 'pattern' : 'term'} "${term}": ${body.slice(0, 100)}`);
    this.name = 'SharingBlacklistError';
  }
}

// 하드 차단: 어떤 맥락에서도 금지 (스하리 본문에 쇼핑 링크 금지 룰)
const HARD_BLACKLIST = ['coupa.ng', 'coupang.com', 'musinsa.com', 'link.coupang', 'smartstore.naver'];

// 소프트 차단: 뻔한 광고·오글·반복 패턴 (사용자 피드백 기반)
const SOFT_BLACKLIST = [
  '사고쳤다', '사고쳤어', '일냈다', '일냈어',             // "사고쳤다" 패턴
  '존예', '갓템', '인생템', '필수템', '강추', '미쳤다',  // 오글
  '맘님들', '언니들',                                    // 셀럽·판매자 말투
];

/** 최근 14일 스하리 본문 (전 계정) — LLM 반복 회피 참고용. */
async function loadRecentSharingBodies(limit: number): Promise<string[]> {
  try {
    const since = new Date(Date.now() - 14 * 864e5);
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

/**
 * 스하리 키워드 포함 && likesCount 상위 벤치마크 few-shot.
 * 광고·판매 글 필터링, 길이 300자 이하만.
 */
async function loadBenchmarkExamples(limit: number): Promise<string[]> {
  try {
    const items = await prisma.benchmarkPost.findMany({
      where: {
        OR: [
          { text: { contains: '스하리' } },
          { text: { contains: '반하리' } },
          { text: { contains: '스친' } },
        ],
        likesCount: { gte: 100 },
      },
      orderBy: { likesCount: 'desc' },
      take: 200,
      select: { text: true, likesCount: true, repliesCount: true },
    });
    const filtered = items.filter((b) => {
      const t = b.text?.trim() ?? '';
      if (!t || t.length > 300) return false;
      // 쇼핑/상품 홍보 글 제외
      if (/coupa\.ng|coupang\.com|musinsa\.com|쿠팡|무신사|할인|체험단|판매|판다|주문|배송/i.test(t)) return false;
      // 정치·시사 키워드 제외 (사용자 리스크 회피)
      if (/우파|좌파|보수|진보|정치|대통령|민주당|국민의힘/.test(t)) return false;
      return true;
    });
    return filtered.slice(0, limit).map((b) => b.text.trim());
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'loadBenchmarkExamples failed');
    return [];
  }
}

function buildSystemPrompt(persona: string, recentBodies: string[], benchmarks: string[]): string {
  return `너는 Threads에서 자연스럽게 "스하리" 글을 쓰는 사람이다.
스하리 = 스친(스레드 친구) + 하트 + 리포스트. 소통·맞팔 늘리기 글.

[페르소나 — 완전 엄수]
${persona}

[벤치마크 TOP 성과 스하리 글 — 패턴·훅 유형만 참고, 절대 복붙 금지]
${benchmarks.map((b, i) => `${i + 1}. ${b}`).join('\n')}

[최근 14일 발행한 스하리 — 같은 공식·같은 어조 금지]
${recentBodies.slice(0, 15).map((b, i) => `${i + 1}. ${b.slice(0, 120)}`).join('\n') || '(없음)'}

[작성 규칙]
0. **발행 시각 = 아침 08:00~09:30 (다음날)**. 바디의 시간·상황 묘사는 아침과 모순되지 않아야 한다.
   - 금지: "밤에", "밤마다", "자기 전", "퇴근하고", "야근", "저녁에", "새벽에", "심야", "지금 자려는데", "라면 끓이는 중" 같은 저녁·밤·심야 시점 묘사.
   - 허용: "오늘 아침", "일어나서", "출근 전", "어제 뭐했는데" (과거 시점은 OK), "요즘", "며칠 전", "이번 주", "오랜만에", "~하다 보니" 같은 모호·과거 표현.
   - 애매하면 시간 언급 자체를 빼라.
1. **글 전체가 하나의 메시지.** "오프너 + 스하리 공식" 억지 조합 X. 벤치마크처럼 자기 상황/정체성/스토리/감정/질문/고민이 **본체**이고 "스친/스하리/반하리" 키워드는 자연스럽게 녹아들 것.
2. 2~5줄, 80~200자. 짧은 공식("스하리 ㄱ 반하리 감") 절대 X — 이게 지금 가장 큰 문제다.
3. 페르소나 말투·금기 표현·이모지 규칙 완전 엄수.
4. **절대 금지**:
   - "스하리 남기면 반하리 감" 류 공식의 단순 반복
   - "사고쳤다/일냈다" 패턴 (뻔한 광고 티)
   - 쿠팡·무신사·상품 링크, 모델명, 상품 묘사
   - 오글 표현(존예·갓템·인생템·강추·미쳤다·맘님들·언니들)
   - 요즘 이슈·시사·정치 (우파/좌파/보수/진보 등)
   - **개인정보 노출 완전 금지** (페르소나에 적혀있어도 글에 쓰면 안 됨):
     * 나이 숫자 (37살·28세 등)
     * 지역 (경기 남부·인천 부평·마포·동/구/시 이름)
     * **가족 관련 일체 언급 금지**: 자녀(애·아들·딸·애기), 배우자(남편·아내·와이프), 부모, 가족 구성원. **존재 자체·행위(등원·재우기·육아) 전부 X**.
     * 직장명·학교명·병원명·회사명
     * 결혼·미혼 여부, 자녀 유무
   - 페르소나의 숫자(나이·연차·거주기간) 그대로 베끼기 금지. "요즘·몇 년째·오랜만에" 같은 모호한 표현 쓸 것.
   - 평범한 일상 톤 유지 — 자극적·세세한 자기개방 X.
   - 페르소나는 **말투·관심사·톤**의 기준일 뿐이다. 페르소나의 신원·가족·사생활은 절대 글에 쓰지 마라.
5. 벤치마크 글 그대로 베끼기 금지. **훅 유형**만 참고:
   - 상황 질문형 (뭐 봤는데/누구 아는 사람 있어?)
   - 자기 공개·정체성 (어디 살고 뭐 하고/몇 살/직업)
   - 감정 토로 (오늘 속상/서운/외로움)
   - 애교 호소 (아무도 안봐줘써/스친 한명만)
   - 자기 스토리 (요즘 이런 일 있었다)
   - 성공담·실패담 (몇 개월 해봤더니 / 또 실패함)
   - 투정·고민 (이거 나만 그래? / 왜 안 올까)
   - 소소한 승리·발견 (이거 이제 알았음)
6. 반드시 JSON 배열 형태로만 응답. 다른 텍스트 금지.`;
}

export async function generateSharingCopy(
  input: SharingCopyInput,
): Promise<SharingCopyResult> {
  const variantCount = input.variantCount ?? 1;
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: input.accountId },
    select: { id: true, handle: true, personaPrompt: true },
  });
  const context = await getAccountContext(input.accountId);

  const [recentBodies, benchmarks] = await Promise.all([
    loadRecentSharingBodies(30),
    loadBenchmarkExamples(10),
  ]);

  const system = buildSystemPrompt(account.personaPrompt, recentBodies, benchmarks);
  const userMsg = `서로 다른 훅 유형 ${variantCount}개로 스하리 글을 작성하라.
각 variant는 위 "훅 유형" 목록에서 서로 다른 것을 골라야 한다.
반드시 아래 JSON 배열만 응답, 그 외 어떤 텍스트도 X:
[${Array.from({ length: variantCount }, () => '{"body":"..."}').join(',')}]`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await llm().complete({
      tier: 'main',
      system,
      userParts: [{ type: 'text', text: userMsg }],
      maxOutputTokens: 1500,
      thinking: 'disabled',
    });

    let parsed: Array<{ body?: unknown }>;
    try {
      const txt = result.text.trim();
      const jsonMatch = txt.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('no json array in output');
      parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) throw new Error('parsed not array');
    } catch (e) {
      logger.warn(
        { handle: account.handle, attempt, err: (e as Error).message, raw: result.text.slice(0, 200) },
        'sharing copy JSON parse fail',
      );
      continue;
    }

    const variants: SharingCopyResult['variants'] = [];
    let blockedReason: string | null = null;
    for (const v of parsed) {
      const body = typeof v?.body === 'string' ? (v.body as string).trim() : '';
      if (!body) { blockedReason = 'empty body'; break; }

      const hard = HARD_BLACKLIST.find((t) => body.toLowerCase().includes(t));
      if (hard) { blockedReason = `hard:${hard}`; break; }
      const soft = SOFT_BLACKLIST.find((t) => body.includes(t));
      if (soft) { blockedReason = `soft:${soft}`; break; }

      if (body.length < 30) { blockedReason = `too_short:${body.length}`; break; }
      if (body.length > 400) { blockedReason = `too_long:${body.length}`; break; }

      variants.push({ body, hookLabel: 'llm', referencesUsed: [] });
    }

    if (blockedReason || variants.length === 0) {
      logger.warn(
        { handle: account.handle, attempt, blockedReason, parsedLen: parsed.length },
        'sharing copy blocked, retrying',
      );
      continue;
    }

    logger.info(
      {
        accountId: account.id, handle: account.handle,
        followers: context.followersCount,
        variantsProduced: variants.length,
        attempt, benchmarksUsed: benchmarks.length,
        recentBodiesChecked: recentBodies.length,
      },
      'sharing copy generated (LLM + persona + benchmark few-shot)',
    );
    return {
      accountId: account.id, handle: account.handle,
      followersCount: context.followersCount, followerBucket: context.followerBucket,
      variants,
    };
  }

  throw new Error(`sharing copy generation failed after ${maxAttempts} attempts for @${account.handle}`);
}
