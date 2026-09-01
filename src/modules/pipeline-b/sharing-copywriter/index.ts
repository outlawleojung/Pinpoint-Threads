import { z } from 'zod';
import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';

/**
 * Pipeline B 스하리 글 각색기.
 *
 * 원칙:
 *   - **계정 페르소나 무관**. 스하리는 계정 정체성과 별개의 소통 요청 글.
 *   - SHARING 벤치마크 풀에서 replies 상위 N개를 few-shot 으로 던지고 LLM 이 각색만 함.
 *   - 문장·수치 복사 X, 훅·리듬·정서만 흡수.
 *   - 본문 마지막 줄에 `#스하리1000명프로젝트` 필수.
 *   - 다른 자체 계정 handle 언급 X (CIB 회피).
 */

const HASHTAG = '#스하리1000명프로젝트';

/** 벤치마크 풀에서 뽑을 상위 replies 후보 수. */
const BENCH_POOL = 5;
/** 그중 LLM 에 few-shot 으로 넣을 개수. */
const FEWSHOT_COUNT = 3;

const BodyResultSchema = z.object({
  body: z.string().min(30).max(300),
});

export interface SharingCopyInput {
  variantCount?: number;
}

export interface SharingCopyResult {
  bodies: string[];
  referencesUsed: Array<{ id: string; sourceHandle: string; repliesCount: number }>;
}

const SYSTEM_PROMPT = `너는 한국 Threads "스하리1000명프로젝트" 해시태그 게시글 각색기다.

역할: **각색가**. 아래 실제 스하리 글들의 훅·리듬·정서를 재활용해 새 스하리 글 하나를 만들어라.

절대 규칙:
- **본문 마지막 줄에 반드시 ${HASHTAG} 를 넣는다.** (없으면 실패)
- 다른 계정 handle(@…) 언급 절대 금지.
- 딥링크·쇼핑 광고·상품 언급 절대 금지 (스하리 글임).
- 참고 글의 **문장·수치·구체 표현을 그대로 복사하지 마라.**
  예: "1000명", "50명 남았음", "3일차" 같은 원본 수치·기간 복사 X.
- 존댓말 X (스레드 반말 기본).

스하리 글 공통 요소 (참고 벤치마크에서 반복되는 패턴):
- 목표·현황 훅 ("아직 100명도 안됨", "1000까지 가보고 싶다")
- 뒷삭·의리 약속 ("뒷삭 X", "뒷삭 절대 안 함")
- 반하리 약속 ("스하리 오면 반하리 바로 감", "선팔하면 백퍼 반하리")
- 소통 요청 ("같이 소통하자", "스친 구함")
- 이 4가지 중 최소 2~3개 조합.

톤:
- 짧고 리드미컬. 2~4줄, 대략 40~150자 (해시태그 포함 200자 이내).
- 이모지 문장 끝 1~2개 (허용: 🙌 💪 🥲 🥹 🫶 🙂 🥺 🌿 🤍 😮‍💨). 하트·별 남발 X.
- LLM 창작 은유·억지 비유 X. 실제 한국인 SNS 자연어만.
- 신상(자녀·직업·나이·거주지·구체 취미) 노출 절대 X. 시간 배경 정도의 매우 일반적 상태만.

출력 포맷:
JSON만. { "body": "여기에 본문 + 마지막 줄 해시태그" }`;

async function generateOne(
  references: Array<{ text: string; repliesCount: number }>,
  variantIndex: number,
): Promise<string> {
  const refLines = references
    .map(
      (r, i) =>
        `${i + 1}. [replies ${r.repliesCount}]\n"""\n${r.text.slice(0, 400)}\n"""`,
    )
    .join('\n\n');

  const userPrompt = [
    '== 참고 스하리 글 (훅·리듬만 흡수, 문장·수치 그대로 복사 X) ==',
    refLines,
    '',
    `variant=${variantIndex}. 위 참고 글들의 훅과 정서를 재활용해 새 스하리 글 하나를 각색해라.`,
    `마지막 줄에 반드시 ${HASHTAG} 포함. JSON 으로만 반환.`,
  ].join('\n');

  const response = await llm().complete({
    tier: 'main',
    system: SYSTEM_PROMPT,
    userParts: [{ type: 'text', text: userPrompt }],
    maxOutputTokens: 400,
    temperature: 0.85 + variantIndex * 0.05,
    jsonMode: true,
    jsonSchema: {
      type: 'object',
      properties: { body: { type: 'string' } },
      required: ['body'],
    },
  });

  const parsed = extractJson(response.text);
  const { body } = BodyResultSchema.parse(parsed);
  return body.includes(HASHTAG) ? body : `${body.trimEnd()}\n${HASHTAG}`;
}

/**
 * 스하리 글 각색 생성. 계정 무관.
 * SHARING 벤치마크 풀 상위 replies N건을 few-shot 으로 사용.
 */
export async function generateSharingCopy(
  input: SharingCopyInput = {},
): Promise<SharingCopyResult> {
  const variantCount = input.variantCount ?? 1;

  const pool = await prisma.benchmarkPost.findMany({
    where: { contentType: 'SHARING' },
    orderBy: { repliesCount: 'desc' },
    take: BENCH_POOL,
    select: { id: true, sourceHandle: true, text: true, repliesCount: true },
  });

  if (pool.length === 0) {
    throw new Error('SHARING 벤치마크 풀 비어있음. 먼저 sharing-collector 로 수집 필요.');
  }

  // 매 variant 마다 pool에서 fewshotCount 무작위 (variantIndex 기반 rotation)
  const bodies: string[] = [];
  for (let i = 0; i < variantCount; i++) {
    const refs = pickReferences(pool, i);
    bodies.push(await generateOne(refs, i));
  }

  const referencesUsed = pool.slice(0, FEWSHOT_COUNT).map((r) => ({
    id: r.id,
    sourceHandle: r.sourceHandle,
    repliesCount: r.repliesCount,
  }));

  logger.info(
    { poolSize: pool.length, variantCount, refsUsed: referencesUsed.length },
    'sharing copy generated',
  );

  return { bodies, referencesUsed };
}

function pickReferences<T>(pool: T[], variantIndex: number): T[] {
  // variant 마다 pool 을 rotation 시켜 다양성 확보
  const rotated = [...pool.slice(variantIndex % pool.length), ...pool.slice(0, variantIndex % pool.length)];
  return rotated.slice(0, FEWSHOT_COUNT);
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
    if (s === -1 || e === -1) throw new Error(`no JSON in response: ${stripped.slice(0, 200)}`);
    return JSON.parse(stripped.slice(s, e + 1));
  }
}
