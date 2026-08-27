import { InlineKeyboard } from 'grammy';

export function approvalKeyboard(postId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ 발행 승인', `approve:${postId}`)
    .text('📝 텍스트 재생성', `regen-text:${postId}`)
    .row()
    .text('🔄 상품 재검색', `regen-product:${postId}`)
    .text('🗑 폐기', `reject:${postId}`);
}
