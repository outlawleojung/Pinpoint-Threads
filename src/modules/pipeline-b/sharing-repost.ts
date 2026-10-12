import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { llm } from '../../infra/llm/index.js';
import { listFolderResources } from '../../infra/cloudinary-client.js';

/**
 * 스하리 재탕 보정 (2026-10-03 사용자 결정).
 *   ① 본문의 팔로워 숫자 주장은 **지금 팔로워에 맞게** 고친다 — 370명 계정이 "300 못 넘김" 그대로 재탕하면 프로필에서 바로 들통.
 *   ② 첨부는 **보관함(sharing-assets) 소재로 바꿔 붙인다** — 스하리 첨부는 글 내용과 무관한 어그로용이라 교체해도 됨.
 *      스하리는 첨부 있는 것만 발행(10/2 결정) → 글만 있던 옛 스하리도 첨부를 달아 재탕.
 */

/** 계정 나이 주장(신생)은 숫자 보정으로 못 고침 → 재탕 대상 제외. */
export const NEW_ACCOUNT_CLAIM = /처음 만들|오늘 가입|새로 만든 계정|막 시작한 계정|갓 만든/;
/** 오래 했다는 주장("몇 달째", "오래 붙잡은") — 만든 지 60일 안 된 계정이 쓰면 거짓 (hanseoa 9/21 생성). */
const LONG_TENURE_CLAIM = /몇\s*달|몇\s*개월|오래\s*(?:된|됐|붙잡|굴린|이어온|하는|했)|오래\s*됐는데|반년|일년|1년/;
const TENURE_MIN_DAYS = 60;

/** 이 계정이 이 글을 써도 계정 나이 면에서 사실인지. */
export function tenureClaimOk(body: string, accountCreatedAt: Date | null | undefined, now = new Date()): boolean {
  if (!LONG_TENURE_CLAIM.test(body)) return true;
  if (!accountCreatedAt) return true;
  return now.getTime() - accountCreatedAt.getTime() >= TENURE_MIN_DAYS * 864e5;
}

/** 목표형(바람): 숫자가 현재보다 크기만 하면 참. */
const GOAL_RE =
  /(\d{2,5})\s*(?:명)?\s*(?:못\s*넘|도\s*안\s*됐|안\s*됐|가고\s*싶|가보고|찍어|찍자|찍고|만\s*가도|만\s*채워|채우고|만\s*찍|까지는?\s*(?:가|안\s*바))/g;
/** 근접형("가는 중·코앞·문턱·언저리"): 현재보다 크고 **가까워야** 참 (83명이 "300 코앞" = 거짓). */
const NEAR_RE = /(\d{2,5})\s*(?:명)?\s*(?:까지\s*)?(?:가는\s*중|코앞|문턱|언저리|앞두고|다\s*와)/g;
const isNear = (n: number, followers: number) => n > followers && n - followers <= Math.max(30, n * 0.3);
/** 달성형: 숫자가 현재 이하여야 참. */
const DONE_RE = /(\d{2,5})\s*(?:명)?\s*(?:겨우\s*)?(?:넘김|넘긴|넘었|넘어서|넘음|돌파|됐|찍었)/g;

/** 숫자 주장이 현재 팔로워 기준 참인지. 틀린 문구 설명을 반환(없으면 null). */
export function falseFollowerClaim(body: string, followers: number): string | null {
  for (const m of body.matchAll(NEAR_RE)) {
    if (!isNear(Number(m[1]), followers)) return `근접 "${m[0]}" — 현재 ${followers}와 거리가 멀거나 이미 넘음`;
  }
  for (const m of body.matchAll(GOAL_RE)) {
    if (Number(m[1]) <= followers) return `목표 "${m[0]}" ≤ 현재 ${followers}`;
  }
  for (const m of body.matchAll(DONE_RE)) {
    const before = body.slice(Math.max(0, (m.index ?? 0) - 3), m.index ?? 0);
    if (/못\s*$/.test(before)) continue;
    if (Number(m[1]) > followers) return `달성 "${m[0]}" > 현재 ${followers}`;
  }
  return null;
}

/**
 * 팔로워 숫자 주장을 현재 수치에 맞게 + 본문 해시태그 제거(태그는 topic_tag 파라미터로만).
 * 이미 참이면 LLM 호출 없이 그대로. 보정 실패·신생 주장 글은 null(재탕 보류).
 */
export async function refreshFollowerClaims(body: string, followers: number): Promise<string | null> {
  if (NEW_ACCOUNT_CLAIM.test(body)) return null;
  const clean = body
    .replace(/^\s*#\S+\s*$/gm, '')
    .replace(/\s*#스하리\S*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!falseFollowerClaim(clean, followers)) return clean;
  const system = [
    '스레드 스하리 글의 재게시용 수정. 글 속 "내 팔로워 수" 숫자만 현재 팔로워 기준으로 **사실이 되게** 고쳐라.',
    '규칙:',
    '- 이미 사실인 표현은 건드리지 마라. (예: 382명일 때 "300 겨우 넘김"은 사실 → 그대로)',
    '- 바람 표현("N 찍자", "N만 가도", "N 못 넘김")의 N은 현재보다 큰 다음 백 단위로. (382명 → 400 또는 500). 현재 숫자(382)를 그대로 쓰지 마라.',
    '- "N 가는 중", "N 코앞", "N 문턱"처럼 거의 다 왔다는 표현은 숫자만 현재와 가까운 다음 목표로 바꾸고 원래 표현은 유지 (83명: "300 코앞까지 왔어" → "100 코앞까지 왔어", "200 가는 중" → "100 가는 중").',
    '- 그 외 문장·말투·이모지·줄바꿈은 한 글자도 바꾸지 마라.',
    'JSON으로만: { "body": "수정된 글" }',
  ].join('\n');
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await llm().complete({
        tier: 'fast',
        system,
        userParts: [{ type: 'text', text: `현재 팔로워: ${followers}명\n\n글:\n${clean}${feedback}` }],
        maxOutputTokens: 600,
        thinking: 'disabled',
        temperature: 0.1,
        jsonMode: true,
        jsonSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
      });
      const m = res.text.match(/\{[\s\S]*\}/);
      const out = (m ? (JSON.parse(m[0]) as { body?: string }).body : null)?.trim();
      if (!out || out.length < clean.length * 0.6 || out.length > clean.length * 1.4) continue;
      const still = falseFollowerClaim(out, followers) ?? (out.includes(String(followers)) ? `현재 숫자 ${followers} 그대로 사용` : null);
      if (!still) return out;
      logger.warn({ still, out, attempt }, 'sharing repost: 보정 후에도 숫자 주장이 사실과 다름');
      feedback = `\n\n(직전 수정본에 아직 틀린 곳: ${still} — 이 부분도 고쳐라)\n직전 수정본:\n${out}`;
    } catch (err) {
      logger.warn({ err }, 'sharing repost: 팔로워 숫자 보정 호출 실패');
    }
  }
  return null; // 재탕 보류
}

/** 보관함에서 아직 어떤 글에도 안 쓴 첨부 하나(영상 우선, 오래된 것부터). 다 썼으면 가장 덜 쓴 것. */
export async function pickSharingAsset(exclude: string[] = []): Promise<string | null> {
  const assets = await listFolderResources(`${env.CLOUDINARY_UPLOAD_FOLDER}/sharing-assets`);
  if (assets.length === 0) return null;
  const posts = await prisma.post.findMany({
    where: { kind: 'SHARING', mediaUrls: { hasSome: assets.map((a) => a.url) } },
    select: { mediaUrls: true },
  });
  const used = new Map<string, number>();
  for (const p of posts) for (const u of p.mediaUrls) used.set(u, (used.get(u) ?? 0) + 1);
  const ranked = assets.filter((a) => !exclude.includes(a.url)).sort(
    (a, b) =>
      (used.get(a.url) ?? 0) - (used.get(b.url) ?? 0) ||
      (a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return ranked[0]?.url ?? null;
}
