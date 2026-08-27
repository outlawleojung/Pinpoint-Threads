import { Bot, InlineKeyboard } from 'grammy';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// 승인 UI 인라인 키보드 (CLAUDE.md §2 Pipeline A 5단계)
export function approvalKeyboard(postId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ 발행 승인', `approve:${postId}`)
    .text('📝 텍스트 재생성', `regen-text:${postId}`)
    .row()
    .text('🔄 상품 재검색', `regen-product:${postId}`)
    .text('🗑 폐기', `reject:${postId}`);
}

// TODO(Phase 2): 콜백 핸들러 등록 (각 액션 → 큐에 잡 투입)
bot.callbackQuery(/^(approve|regen-text|regen-product|reject):(.+)$/, async (ctx) => {
  const [action, postId] = ctx.match!.slice(1);
  logger.info({ action, postId }, 'telegram callback received');
  await ctx.answerCallbackQuery(`받았습니다: ${action}`);
  // TODO: 상태 머신 이벤트 발행
});
