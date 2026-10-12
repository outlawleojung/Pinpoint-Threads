import { InlineKeyboard } from 'grammy';

export function approvalKeyboard(postId: string, altCount = 0): InlineKeyboard {
  // 소재 감시 카드: 한마디 후보 ①② 중 골라서 바로 승인 (2026-10-12)
  if (altCount > 1) {
    const kb = new InlineKeyboard();
    for (let i = 0; i < altCount; i++) kb.text(`✅ ${'①②③'[i]} 로 승인`, `alt:${i}:${postId}`);
    return kb.row().text('📝 텍스트 재생성', `regen-text:${postId}`).text('🗑 폐기', `reject:${postId}`);
  }
  return new InlineKeyboard()
    .text('✅ 발행 승인', `approve:${postId}`)
    .text('📝 텍스트 재생성', `regen-text:${postId}`)
    .row()
    .text('🔄 상품 재검색', `regen-product:${postId}`)
    .text('🗑 폐기', `reject:${postId}`);
}
