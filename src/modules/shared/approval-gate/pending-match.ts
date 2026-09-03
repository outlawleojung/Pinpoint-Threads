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
const TTL_SEC = 24 * 60 * 60;

export interface PendingMatchEntry {
  benchmarkPostId: string;
  accountId: string;
  accountHandle: string;
  createdAt: string;
}

export async function sendMatchWaitingCard(input: {
  benchmarkPostId: string;
  accountId: string;
  accountHandle: string;
  benchmarkText: string;
  benchmarkPermalink: string;
  benchmarkMediaUrls: string[];
}): Promise<{ msgId: number } | null> {
  const caption = [
    '⚠️ 매칭 실패 — URL 답장 부탁',
    `계정: ${input.accountHandle}`,
    `벤치마크: ${input.benchmarkPermalink}`,
    '',
    '━━━ 원본 텍스트 ━━━',
    input.benchmarkText.slice(0, 400),
    '',
    '📎 이 메시지에 답장으로 **쿠팡·무신사·네이버 상품 URL** 을 보내주세요.',
    '   → 자동으로 하이브리드 발행 파이프에 투입됩니다.',
    '   24시간 내 답장 없으면 대기 해제.',
  ].join('\n');

  const media = input.benchmarkMediaUrls.slice(0, 10);

  try {
    let msgId: number;
    const isVideoUrl = (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/');
    const withExt = (u: string): string =>
      isVideoUrl(u) && !/\.mp4(?:\?|$)/i.test(u)
        ? u.split('?')[0] + '.mp4' + (u.includes('?') ? '?' + u.split('?').slice(1).join('?') : '')
        : u;

    if (media.length >= 2) {
      const group = media.map((url, i) => ({
        type: (isVideoUrl(url) ? 'video' : 'photo') as 'photo' | 'video',
        media: withExt(url),
        caption: i === 0 ? caption : undefined,
      }));
      const msgs = await bot.api.sendMediaGroup(env.TELEGRAM_ADMIN_CHAT_ID, group);
      msgId = msgs[0]?.message_id ?? 0;
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
    };
    await redisConnection.set(KEY_PREFIX + msgId, JSON.stringify(entry), 'EX', TTL_SEC);
    logger.info({ msgId, benchmarkPostId: input.benchmarkPostId, handle: input.accountHandle }, 'match-waiting card sent');
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
