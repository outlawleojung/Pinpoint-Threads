import { Bot } from 'grammy';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { handleApprovalCallback, sendApprovalRequest } from '../../services/approval-service.js';
import { prisma } from '../../db/prisma.js';
import { PostState } from '@prisma/client';
import { classifySourceItem } from '../anthropic/classify.js';
import { generateCopy } from '../anthropic/copywriter.js';
import { verifyProductMatch } from '../anthropic/vision-match.js';

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
      '- /ping : 헬스체크\n' +
      '- /newpost : 더미 승인 요청 발송\n' +
      '- /classify : Claude 분류 테스트\n' +
      '- /copy : 게시글 카피 1개 생성\n' +
      '- /copy3 : 게시글 카피 3개 후보 생성\n' +
      '- /vision : Claude Vision 이미지 정합성 테스트',
  );
});

bot.command('ping', async (ctx) => {
  await ctx.reply('pong 🏓');
});

// Claude 분류 테스트
bot.command('classify', async (ctx) => {
  await ctx.reply('분류 중... (Haiku)');
  try {
    const result = await classifySourceItem({
      text: '요즘 자취방 필수템! USB로 충전되는 미니 무선 가습기 진짜 편해요. 물통도 세척 편하고 조용해서 잘 때도 좋음.',
      mediaUrls: ['https://picsum.photos/seed/humidifier/600/600'],
    });
    await ctx.reply(
      '📊 분류 결과\n\n' +
        '```json\n' +
        JSON.stringify(result, null, 2) +
        '\n```',
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.error(err, '/classify failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});

// Claude 카피 테스트 (쿠파스 게시글 생성기 스타일)
bot.command('copy', async (ctx) => {
  await ctx.reply('카피 생성 중... (Sonnet)');
  try {
    const result = await generateCopy({
      sourceText: 'USB 충전 미니 무선 가습기. 조용하고 세척 편함.',
      sourceImageUrl: 'https://picsum.photos/seed/humidifier/600/600',
      productName: '휴대용 무선 가습기 500ml',
      productCategory: '생활용품',
      accountSeed: 'dummy_kr_01',
      deeplinkUrl: 'https://link.coupang.com/dummy',
      channel: 'COUPANG',
    });
    await ctx.reply(
      `📝 *본문*\n${result.body}\n\n💬 *고정 댓글*\n${result.reply}`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.error(err, '/copy failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});

// 카피 3개 후보 (재생성 스타일)
bot.command('copy3', async (ctx) => {
  await ctx.reply('카피 3개 후보 생성 중... (Sonnet x3)');
  try {
    const { generateBodyVariants } = await import('../anthropic/copywriter.js');
    const variants = await generateBodyVariants(
      {
        sourceImageUrl: 'https://picsum.photos/seed/humidifier/600/600',
        sourceText: 'USB 충전 미니 무선 가습기. 조용하고 세척 편함.',
        productName: '휴대용 무선 가습기 500ml',
        productCategory: '생활용품',
        accountSeed: 'dummy_kr_01',
        deeplinkUrl: 'https://link.coupang.com/dummy',
        channel: 'COUPANG',
      },
      3,
    );
    await ctx.reply(
      variants.map((v, i) => `${i + 1}. ${v}`).join('\n\n'),
    );
  } catch (err) {
    logger.error(err, '/copy3 failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});

// Claude Vision 정합성 테스트
bot.command('vision', async (ctx) => {
  await ctx.reply('Vision 매칭 중... (Sonnet)');
  try {
    const result = await verifyProductMatch({
      sourceImageUrl: 'https://picsum.photos/seed/humidifier/600/600',
      productThumbnailUrl: 'https://picsum.photos/seed/humidifier2/600/600',
    });
    await ctx.reply(
      '👁 Vision 결과\n\n' +
        '```json\n' +
        JSON.stringify(result, null, 2) +
        '\n```',
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.error(err, '/vision failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
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
