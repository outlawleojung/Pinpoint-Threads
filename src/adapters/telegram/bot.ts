import { Bot } from 'grammy';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { handleApprovalCallback, sendApprovalRequest } from '../../services/approval-service.js';
import { prisma } from '../../db/prisma.js';
import { PostState } from '@prisma/client';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// 어드민 채팅만 허용
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id?.toString();
  if (chatId && chatId !== env.TELEGRAM_ADMIN_CHAT_ID) {
    logger.warn({ chatId }, 'unauthorized chat blocked');
    return;
  }
  await next();
});

// /start — 봇 살아있는지 확인용
bot.command('start', async (ctx) => {
  await ctx.reply(
    'Pinpoint Threads 승인 봇이 연결되었습니다.\n\n' +
      '- /newpost : 더미 승인 요청 발송 (Phase 2A 테스트)\n' +
      '- /ping : 헬스체크',
  );
});

bot.command('ping', async (ctx) => {
  await ctx.reply('pong 🏓');
});

// /newpost — 테스트용 더미 승인 요청 발송
bot.command('newpost', async (ctx) => {
  await ctx.reply('더미 Post 생성 중...');
  try {
    const account = await ensureDummyAccount();
    const source = await prisma.sourceItem.create({
      data: {
        sourceUrl: `https://example.com/dummy/${Date.now()}`,
        contentHash: `hash-${Date.now()}`,
        rawText: '해외 인기 꿀템: 무선 가습기 후기',
        mediaUrls: [],
        authorHandle: 'jp_trend',
        language: 'ja',
      },
    });
    const product = await prisma.commerceProduct.create({
      data: {
        channel: 'COUPANG',
        externalId: `dummy-${Date.now()}`,
        productName: '휴대용 무선 가습기 500ml',
        productUrl: 'https://www.coupang.com/vp/products/dummy',
        deeplinkUrl: 'https://link.coupang.com/dummy',
        thumbnailUrl: 'https://picsum.photos/seed/humidifier/600/600',
        price: 24900,
        rating: 4.7,
        category: '생활용품',
      },
    });
    const post = await prisma.post.create({
      data: {
        state: PostState.COPYWRITING,
        accountId: account.id,
        sourceItemId: source.id,
        commerceProductId: product.id,
        mediaUrl: 'https://picsum.photos/seed/humidifier/600/600',
        generatedBody:
          '요즘 책상 위에 하나씩 놓는 그거 있잖아요.\n작고 조용한데 물안개가 은근 뿜어져 나오는 그 가습기.\n\n올 겨울 실내 건조함 잡는 데 진짜 물건이에요.',
        generatedReply:
          '정보 물어보시는 분들 많아서 링크 남겨요 🙌\nhttps://link.coupang.com/dummy\n\n이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
      },
    });
    await sendApprovalRequest(post.id);
    await ctx.reply(`✔ 발송 완료 (Post ID: \`${post.id}\`)`, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error(err, '/newpost failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});

// 승인/거부 콜백
bot.callbackQuery(/^(approve|regen-text|regen-product|reject):(.+)$/, async (ctx) => {
  const match = ctx.match;
  if (!match) return;
  const action = match[1] as 'approve' | 'regen-text' | 'regen-product' | 'reject';
  const postId = match[2] ?? '';
  logger.info({ action, postId }, 'telegram callback received');

  try {
    const label = await handleApprovalCallback(action, postId);
    await ctx.answerCallbackQuery({ text: label });
    // 원본 메시지 하단에 처리 결과 반영
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(`처리됨: ${label}\nPost: \`${postId}\``, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error({ err, action, postId }, 'callback handler failed');
    await ctx.answerCallbackQuery({ text: `실패: ${(err as Error).message}`, show_alert: true });
  }
});

async function ensureDummyAccount() {
  const existing = await prisma.account.findFirst({ where: { handle: 'dummy_kr_01' } });
  if (existing) return existing;
  return prisma.account.create({
    data: {
      handle: 'dummy_kr_01',
      threadsUserId: 'dummy-threads-user-01',
      accessToken: 'dummy-token',
      personaPrompt:
        '20대 후반 자취녀 톤. 편안한 구어체, 이모지 절제(1~2개), 첫 줄 후킹.',
      timezone: 'Asia/Seoul',
      activeHourStart: 8,
      activeHourEnd: 23,
    },
  });
}

bot.catch((err) => {
  logger.error({ err }, 'grammY error handler');
});
