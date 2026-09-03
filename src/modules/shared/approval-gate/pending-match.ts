import { redisConnection } from '../../../queues/connection.js';
import { bot } from './bot.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

/**
 * 매칭 실패 대기 카드.
 *
 * 흐름:
 *  - shopping-publisher 가 Pipeline A 매칭 실패 (vision-failed 등) 감지
 *  - sendMatchWaitingCard() 호출 → 텔레그램에 원본 미디어·텍스트 카드 발송
 *  - Redis 에 { msgId → benchmarkPostId + accountId } 매핑 저장 (TTL 24h)
 *  - 사용자님이 그 카드에 답장으로 쿠팡·무신사·네이버 URL 던짐
 *  - bot 의 message:text 핸들러가 reply_to 감지 → Redis 조회 → hybrid Pipeline A 재실행
 */

const KEY_PREFIX = 'pending-match:';
const CODE_PREFIX = 'pending-code:';
const TTL_SEC = 24 * 60 * 60;

export interface PendingMatchEntry {
  benchmarkPostId: string;
  accountId: string;
  accountHandle: string;
  createdAt: string;
  code?: string;
}

/**
 * 벤치마크 ID 로부터 4자리 회신 코드 생성 (혼동 문자 제외 · 대문자+숫자).
 * 같은 벤치마크는 항상 같은 코드 (idempotent).
 */
function makeCode(benchmarkPostId: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I,O,0,1 제외
  let hash = 0;
  for (let i = 0; i < benchmarkPostId.length; i++) {
    hash = (hash * 31 + benchmarkPostId.charCodeAt(i)) >>> 0;
  }
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length) + benchmarkPostId.charCodeAt(i % benchmarkPostId.length);
  }
  return code;
}

export async function sendMatchWaitingCard(input: {
  benchmarkPostId: string;
  accountId: string;
  accountHandle: string;
  benchmarkText: string;
  benchmarkPermalink: string;
  benchmarkMediaUrls: string[];
}): Promise<{ msgId: number } | null> {
  const code = makeCode(input.benchmarkPostId);
  const caption = [
    `⚠️ 매칭 실패 — 회신코드 [ ${code} ]`,
    `계정: ${input.accountHandle}`,
    `벤치마크: ${input.benchmarkPermalink}`,
    '',
    '━━━ 원본 텍스트 ━━━',
    input.benchmarkText.slice(0, 400),
    '',
    `📎 일반 메시지로 아래처럼 보내주세요 (답장 X):`,
    `   ${code} https://링크...`,
    '   → 쿠팡·무신사·네이버 상품 URL. 자동 하이브리드 발행.',
    '   24시간 내 미회신 시 대기 해제.',
  ].join('\n');

  const media = input.benchmarkMediaUrls.slice(0, 10);

  try {
    let msgId: number;
    const isVideoUrl = (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');
    const withExt = (u: string): string =>
      isVideoUrl(u) && !/\.mp4(?:\?|$)/i.test(u)
        ? u.split('?')[0] + '.mp4' + (u.includes('?') ? '?' + u.split('?').slice(1).join('?') : '')
        : u;

    let groupMsgIds: number[] = [];
    if (media.length >= 2) {
      const group = media.map((url, i) => ({
        type: (isVideoUrl(url) ? 'video' : 'photo') as 'photo' | 'video',
        media: withExt(url),
        caption: i === 0 ? caption : undefined,
      }));
      const msgs = await bot.api.sendMediaGroup(env.TELEGRAM_ADMIN_CHAT_ID, group);
      msgId = msgs[0]?.message_id ?? 0;
      // 앨범(미디어 그룹)은 여러 메시지 → 사용자가 어느 이미지에 답장해도 매칭되게 전부 저장
      groupMsgIds = msgs.map((m) => m.message_id);
    } else if (media.length === 1) {
      const only = withExt(media[0]!);
      const msg = isVideoUrl(only)
        ? await bot.api.sendVideo(env.TELEGRAM_ADMIN_CHAT_ID, only, { caption })
        : await bot.api.sendPhoto(env.TELEGRAM_ADMIN_CHAT_ID, only, { caption });
      msgId = msg.message_id;
    } else {
      const msg = await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, caption);
      msgId = msg.message_id;
    }

    const entry: PendingMatchEntry = {
      benchmarkPostId: input.benchmarkPostId,
      accountId: input.accountId,
      accountHandle: input.accountHandle,
      createdAt: new Date().toISOString(),
      code,
    };
    const payload = JSON.stringify(entry);
    // 1) 회신코드로 저장 (답장 없이 "코드 URL" 일반 메시지로 매칭 · 텔레그램 답장 차단 회피)
    await redisConnection.set(CODE_PREFIX + code, payload, 'EX', TTL_SEC);
    // 2) 앨범 메시지 ID 로도 저장 (답장 가능한 환경 백업)
    const idsToStore = groupMsgIds.length > 0 ? groupMsgIds : [msgId];
    await Promise.all(idsToStore.map((id) => redisConnection.set(KEY_PREFIX + id, payload, 'EX', TTL_SEC)));
    logger.info({ msgId, code, groupMsgIds: idsToStore, benchmarkPostId: input.benchmarkPostId, handle: input.accountHandle }, 'match-waiting card sent');
    return { msgId };
  } catch (err) {
    logger.error({ err, benchmarkPostId: input.benchmarkPostId }, 'sendMatchWaitingCard failed');
    return null;
  }
}

export async function getPendingMatch(msgId: number): Promise<PendingMatchEntry | null> {
  const raw = await redisConnection.get(KEY_PREFIX + msgId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingMatchEntry;
  } catch {
    return null;
  }
}

export async function clearPendingMatch(msgId: number): Promise<void> {
  await redisConnection.del(KEY_PREFIX + msgId);
}

/**
 * 회신코드로 대기 엔트리 조회 (답장 없이 "코드 URL" 메시지 매칭).
 */
export async function getPendingByCode(code: string): Promise<PendingMatchEntry | null> {
  const raw = await redisConnection.get(CODE_PREFIX + code.toUpperCase());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingMatchEntry;
  } catch {
    return null;
  }
}

export async function clearPendingByCode(code: string): Promise<void> {
  await redisConnection.del(CODE_PREFIX + code.toUpperCase());
}
