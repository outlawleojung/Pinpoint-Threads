import { Api, GrammyError } from 'grammy';
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
