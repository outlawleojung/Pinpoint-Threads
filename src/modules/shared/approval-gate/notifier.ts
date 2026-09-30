import { Api, GrammyError, InlineKeyboard } from 'grammy';
import type { DiscoveryCandidate } from '../discovery/types.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

/**
 * bot 인스턴스와 별개로 워커/스케줄러에서 텔레그램 관리자 채팅에 메시지 발송할 때 사용.
 * grammY Api 클래스로 직접 sendMessage 호출.
 */

const api = new Api(env.TELEGRAM_BOT_TOKEN);
const chatId = env.TELEGRAM_ADMIN_CHAT_ID;

export async function sendDigestMessage(text: string): Promise<void> {
  try {
    await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
    logger.info({ len: text.length }, 'digest sent to telegram');
  } catch (err) {
    if (err instanceof GrammyError) {
      logger.error({ code: err.error_code, description: err.description }, 'telegram send failed');
    } else {
      logger.error({ err }, 'telegram send failed (unknown)');
    }
  }
}


const fmtK = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n.toLocaleString('ko-KR'));

/** 발굴 후보 카드 내용(캡션·버튼) — 봇 `소재` 응답과 아침 자동 전송이 공용. */
export function discoveryCardContent(c: DiscoveryCandidate): { caption: string; keyboard: InlineKeyboard } {
  const keyboard =
    c.kindHint === 'shopping'
      ? new InlineKeyboard().text('🛍 쇼핑글', `disc:shop:${c.id}`).text('🌿 일상글', `disc:daily:${c.id}`).text('⏭ 스킵', `disc:skip:${c.id}`)
      : new InlineKeyboard().text('🌿 일상글 만들기', `disc:daily:${c.id}`).text('⏭ 스킵', `disc:skip:${c.id}`);
  const mediaLabel = c.hasVideo ? '🎬 영상' : `🖼 이미지 ${c.mediaCount}`;
  const kindLabel = c.kindHint === 'shopping' ? '🛍 쇼핑 후보' : '🐾 일상 후보';
  const react = c.replies != null ? ` 💬${fmtK(c.replies)}` : '';
  const caption = [
    `${kindLabel} · ❤${fmtK(c.likes ?? c.score)}${react} · ${mediaLabel} · @${c.authorHandle ?? '?'} (${c.lang ?? '?'})`,
    c.title,
    c.sourceUrl,
  ].join('\n');
  return { caption, keyboard };
}

/** 워커(아침 크론)에서 발굴 후보 카드 전송. */
export async function sendDiscoveryCards(cands: DiscoveryCandidate[], intro: string): Promise<void> {
  await sendDigestMessage(intro);
  for (const c of cands) {
    const { caption, keyboard } = discoveryCardContent(c);
    try {
      if (c.thumbnailUrl) await api.sendPhoto(chatId, c.thumbnailUrl, { caption, reply_markup: keyboard });
      else await api.sendMessage(chatId, caption, { reply_markup: keyboard });
    } catch {
      await api.sendMessage(chatId, caption, { reply_markup: keyboard }).catch(() => {});
    }
  }
}
