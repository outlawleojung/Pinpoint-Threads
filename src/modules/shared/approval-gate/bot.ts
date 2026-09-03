import { Bot } from 'grammy';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { handleApprovalCallback, sendApprovalRequest } from './service.js';
import { prisma } from '../../../db/prisma.js';
import { PostState } from '@prisma/client';
import { classifySourceItem } from '../content-classifier/index.js';
import { generateCopy } from '../copywriter/index.js';
import { verifyProductMatch } from '../../pipeline-a/vision-verifier/index.js';
import { CoupangAdapter } from '../../../infra/commerce/coupang-client.js';
import { composeReply } from '../../pipeline-a/reply-composer/index.js';
import { matchProduct } from '../../pipeline-a/product-matcher/index.js';
import { runPipelineA } from '../../pipeline-a/orchestrator.js';
import { ingestUrlsFromText, ingestUrl } from '../url-ingester/index.js';
import { isCommerceUrl, splitBenchmarkAndCommerce } from '../url-ingester/platform-detector.js';
import { InboundSource } from '@prisma/client';
import { detectPlatform, extractUrls } from '../url-ingester/platform-detector.js';

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
      '- /vision : Claude Vision 이미지 정합성 테스트\n' +
      '- /coupang <검색어> : 쿠팡 상품 검색 실 API 테스트\n' +
      '- /deeplink <쿠팡URL> : 쿠팡 딥링크 생성 실 API 테스트\n' +
      '- /ingest <URL> : URL 인제스터 수동 테스트 (Threads·TikTok·샤오홍슈·Instagram)\n\n' +
      '💡 URL만 그대로 메시지에 붙여넣어도 자동 인제스트됩니다.',
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
      mediaUrls: ['https://ads-partners.coupang.com/image1/T66Ju4qb_ZdJBMXjTzSbewR2XoTQo2xv6WoXcFBAaibSodiHvpvmTOSc0ykq7X-3WP2NNh8ZeonsVNxqQOw7XxTRzYV7-EH4JKyAo4rmjI9t81zSeHs_M_PxCNE3YH-gbrNurgw0a12nPilWLmowyQMmshu5dO0xG2_ZXHi3NuYVVw1Vol07zCIsXFNNRhpJx0YiENiCzv3CdWiVoN2ZImAR4YVbq2Yj4DcZKue4xdv7zyRTWqOTqTRT5jvdii-re1ByI5zoZeI5aQzjwMJte3VEqaNbuLRy9iPpqnCMzMEewzDM3HMAIYvIZA=='],
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

// 본문 + AI 감초 톤 댓글 테스트
bot.command('copy', async (ctx) => {
  await ctx.reply('카피 생성 중... (본문 + AI 감초 톤 댓글)');
  try {
    const productName = '휴대용 무선 가습기 500ml';
    const deeplinkUrl = 'https://link.coupang.com/a/gzTOZtY7Ai';
    const testAccount = await getAnyActiveAccount();
    const accountId = testAccount.id;

    const copyResult = await generateCopy({
      sourceText: 'USB 충전 미니 무선 가습기. 조용하고 세척 편함.',
      sourceImageUrl: 'https://ads-partners.coupang.com/image1/T66Ju4qb_ZdJBMXjTzSbewR2XoTQo2xv6WoXcFBAaibSodiHvpvmTOSc0ykq7X-3WP2NNh8ZeonsVNxqQOw7XxTRzYV7-EH4JKyAo4rmjI9t81zSeHs_M_PxCNE3YH-gbrNurgw0a12nPilWLmowyQMmshu5dO0xG2_ZXHi3NuYVVw1Vol07zCIsXFNNRhpJx0YiENiCzv3CdWiVoN2ZImAR4YVbq2Yj4DcZKue4xdv7zyRTWqOTqTRT5jvdii-re1ByI5zoZeI5aQzjwMJte3VEqaNbuLRy9iPpqnCMzMEewzDM3HMAIYvIZA==',
      productName,
      productCategory: '생활용품',
      accountSeed: accountId,
      deeplinkUrl,
      channel: 'COUPANG',
    });

    const reply = await composeReply({
      body: copyResult.body,
      productName,
      productCategory: '생활용품',
      deeplinkUrl,
      accountId,
    });

    await ctx.reply(
      `📝 본문\n\n${copyResult.body}\n\n\n💬 고정 댓글\n\n${reply.text}`,
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
    const { generateBodyVariants } = await import('../copywriter/index.js');
    const variants = await generateBodyVariants(
      {
        sourceImageUrl: 'https://ads-partners.coupang.com/image1/T66Ju4qb_ZdJBMXjTzSbewR2XoTQo2xv6WoXcFBAaibSodiHvpvmTOSc0ykq7X-3WP2NNh8ZeonsVNxqQOw7XxTRzYV7-EH4JKyAo4rmjI9t81zSeHs_M_PxCNE3YH-gbrNurgw0a12nPilWLmowyQMmshu5dO0xG2_ZXHi3NuYVVw1Vol07zCIsXFNNRhpJx0YiENiCzv3CdWiVoN2ZImAR4YVbq2Yj4DcZKue4xdv7zyRTWqOTqTRT5jvdii-re1ByI5zoZeI5aQzjwMJte3VEqaNbuLRy9iPpqnCMzMEewzDM3HMAIYvIZA==',
        sourceText: 'USB 충전 미니 무선 가습기. 조용하고 세척 편함.',
        productName: '휴대용 무선 가습기 500ml',
        productCategory: '생활용품',
        accountSeed: (await getAnyActiveAccount()).id,
        deeplinkUrl: 'https://link.coupang.com/dummy',
        channel: 'COUPANG',
      },
      3,
    );
    await ctx.reply(
      variants.map((v: string, i: number) => `${i + 1}. ${v}`).join('\n\n'),
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
      sourceImageUrl: 'https://ads-partners.coupang.com/image1/T66Ju4qb_ZdJBMXjTzSbewR2XoTQo2xv6WoXcFBAaibSodiHvpvmTOSc0ykq7X-3WP2NNh8ZeonsVNxqQOw7XxTRzYV7-EH4JKyAo4rmjI9t81zSeHs_M_PxCNE3YH-gbrNurgw0a12nPilWLmowyQMmshu5dO0xG2_ZXHi3NuYVVw1Vol07zCIsXFNNRhpJx0YiENiCzv3CdWiVoN2ZImAR4YVbq2Yj4DcZKue4xdv7zyRTWqOTqTRT5jvdii-re1ByI5zoZeI5aQzjwMJte3VEqaNbuLRy9iPpqnCMzMEewzDM3HMAIYvIZA==',
      productThumbnailUrl: 'https://ads-partners.coupang.com/image1/SUsoHHTK_MmpXOkoSVC7e8PAA-M0-aLul4kYkx6_f6QcAky0tKmtLOK472Cg9SezxdBJckDdqzDXVs93PyfZ8gkBwcFRYrHAQfXG2NWDgD9Bt1Lxb4zAd6YG-RywA7MVAf8G0UcQf2PejCbKmOSlB_ydS3MI0HQlXCh-ZMnkg2maEjTIppafJRf4DoxSTS2gGjR9wWYbMZfwIJreUwkwmi-4u5BWdJcGneStqA7SjN0x6F0W_sFeYz0_fI0WPxoczSF2Mrr3lwYwXgc6olauDivcuV3W74MKCYfmuku0mXDDf29pTjkr8FH0uSM5gtqYBRgpfA==',
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

// 쿠팡 실 API — 상품 검색
bot.command('coupang', async (ctx) => {
  const keyword = ctx.match?.trim() || '무선 가습기';
  await ctx.reply(`쿠팡 검색 중: "${keyword}"...`);
  try {
    const adapter = new CoupangAdapter(
      env.COUPANG_ACCESS_KEY ?? '',
      env.COUPANG_SECRET_KEY ?? '',
    );
    const results = await adapter.search(keyword, { limit: 5 });
    if (!results.length) {
      await ctx.reply('결과 없음');
      return;
    }
    const summary = results
      .slice(0, 5)
      .map((r, i) =>
        `${i + 1}. ${r.productName}\n   ₩${r.price?.toLocaleString?.() ?? '?'} · ${r.channel}\n   상품: ${r.productUrl}\n   이미지: ${r.thumbnailUrl}`,
      )
      .join('\n\n');
    await ctx.reply(
      `🛒 쿠팡 검색 결과 (${results.length})\n\n${summary}\n\n💡 이미지 URL을 /matcher 에 넣으면 e2e 검증 가능`,
    );
  } catch (err) {
    logger.error(err, '/coupang failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});

// 쿠팡 실 API — 딥링크 생성
bot.command('deeplink', async (ctx) => {
  const url = ctx.match?.trim();
  if (!url) {
    await ctx.reply('사용법: /deeplink <쿠팡상품URL>\n예: /deeplink https://www.coupang.com/vp/products/12345');
    return;
  }
  await ctx.reply(`딥링크 생성 중...`);
  try {
    const adapter = new CoupangAdapter(
      env.COUPANG_ACCESS_KEY ?? '',
      env.COUPANG_SECRET_KEY ?? '',
    );
    const short = await adapter.generateDeeplink(url);
    await ctx.reply(`🔗 딥링크\n${short}`);
  } catch (err) {
    logger.error(err, '/deeplink failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});

// /matcher — Product Matcher 통합 검증 (Coupang 검색 + Vision Self-Correction Loop + 딥링크)
bot.command('matcher', async (ctx) => {
  const raw = ctx.match?.trim();
  if (!raw) {
    await ctx.reply(
      '사용법: /matcher <이미지URL> | <검색키워드> [ | 카테고리]\n' +
        '예: /matcher https://picsum.photos/seed/humidifier/600/600 | 무선 가습기 | 생활용품',
    );
    return;
  }
  const parts = raw.split('|').map((s) => s.trim());
  const sourceImageUrl = parts[0] ?? '';
  const searchKeyword = parts[1] || '무선 가습기';
  const category = parts[2] || '생활용품';
  if (!sourceImageUrl) {
    await ctx.reply('이미지 URL이 필요합니다.');
    return;
  }

  await ctx.reply(
    `🔎 매칭 시도\n이미지: ${sourceImageUrl}\n키워드: ${searchKeyword}\n카테고리: ${category}\n\nCoupang 검색 → Vision 검증 → 딥링크 (최대 3회)`,
  );
  try {
    const outcome = await matchProduct({ category, searchKeyword, sourceImageUrl, maxAttempts: 3 });

    if (!outcome.success) {
      await ctx.reply(
        `❌ 매칭 실패\n사유: ${outcome.reason}\n시도: ${outcome.attempts}회`,
      );
      return;
    }

    const r = outcome.result;
    await ctx.reply(
      `✅ 매칭 성공 (시도 ${r.attempts}회, Vision score ${r.visionScore.toFixed(2)})\n\n` +
        `상품명: ${r.product.productName}\n` +
        `가격: ${r.product.price?.toLocaleString?.() ?? '?'}원\n` +
        `채널: ${r.channel}\n\n` +
        `원본 URL: ${r.product.productUrl}\n` +
        `딥링크: ${r.deeplinkUrl}`,
    );
  } catch (err) {
    logger.error(err, '/matcher failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});

// /pa — Pipeline A 전체 e2e (Task #3h)
// 사용법: /pa <mediaUrl1> <mediaUrl2> [<mediaUrl3>...] || <sourceText>
bot.command('pa', async (ctx) => {
  const raw = ctx.match?.trim();
  if (!raw) {
    await ctx.reply(
      '사용법:\n/pa <mediaUrl1> <mediaUrl2> [<mediaUrl3>...] || <sourceText>\n\n' +
        '예:\n/pa https://.../a.jpg https://.../b.jpg || 요즘 자취방 필수템 무선 미니 가습기 진짜 편해요',
    );
    return;
  }
  const [mediaPart, ...textParts] = raw.split('||').map((s) => s.trim());
  const sourceText = textParts.join(' | ').trim();
  const sourceMediaUrls = (mediaPart ?? '').split(/\s+/).filter(Boolean);
  if (sourceMediaUrls.length < 2) {
    await ctx.reply(`❌ 미디어 2개 이상 필요 (지금 ${sourceMediaUrls.length}개)`);
    return;
  }
  if (!sourceText) {
    await ctx.reply('❌ || 뒤에 sourceText 필요');
    return;
  }

  // 더미 계정 확보
  const account = await getAnyActiveAccount();

  await ctx.reply(
    `🚀 Pipeline A e2e 시작\n계정: ${account.handle}\n미디어: ${sourceMediaUrls.length}개\nsourceText: ${sourceText.slice(0, 80)}...\n\n분류 → 매칭 → 미디어 업로드 → 카피 → 승인 카드`,
  );

  try {
    const outcome = await runPipelineA({
      accountId: account.id,
      sourceMediaUrls,
      sourceText,
    });

    if (outcome.status === 'REJECTED') {
      await ctx.reply(`❌ Pipeline REJECTED\n단계: ${outcome.stage}\n사유: ${outcome.reason}`);
      return;
    }

    await ctx.reply(
      `✅ 승인 카드 발송 완료\nPost ID: ${outcome.postId}\n상품: ${outcome.matchedProductName}\nVision score: ${outcome.visionScore.toFixed(2)}\n감초 리드: "${outcome.replyLead}"\n\n승인 카드에서 버튼 클릭 → 상태 전이 검증`,
    );
  } catch (err) {
    logger.error(err, '/pa failed');
    await ctx.reply(`❌ 예외: ${(err as Error).message}`);
  }
});

// /newpost — 테스트용 더미 승인 요청 발송
bot.command('newpost', async (ctx) => {
  await ctx.reply('더미 Post 생성 중...');
  try {
    const account = await getAnyActiveAccount();
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
        thumbnailUrl: 'https://ads-partners.coupang.com/image1/T66Ju4qb_ZdJBMXjTzSbewR2XoTQo2xv6WoXcFBAaibSodiHvpvmTOSc0ykq7X-3WP2NNh8ZeonsVNxqQOw7XxTRzYV7-EH4JKyAo4rmjI9t81zSeHs_M_PxCNE3YH-gbrNurgw0a12nPilWLmowyQMmshu5dO0xG2_ZXHi3NuYVVw1Vol07zCIsXFNNRhpJx0YiENiCzv3CdWiVoN2ZImAR4YVbq2Yj4DcZKue4xdv7zyRTWqOTqTRT5jvdii-re1ByI5zoZeI5aQzjwMJte3VEqaNbuLRy9iPpqnCMzMEewzDM3HMAIYvIZA==',
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
        mediaUrl: 'https://ads-partners.coupang.com/image1/T66Ju4qb_ZdJBMXjTzSbewR2XoTQo2xv6WoXcFBAaibSodiHvpvmTOSc0ykq7X-3WP2NNh8ZeonsVNxqQOw7XxTRzYV7-EH4JKyAo4rmjI9t81zSeHs_M_PxCNE3YH-gbrNurgw0a12nPilWLmowyQMmshu5dO0xG2_ZXHi3NuYVVw1Vol07zCIsXFNNRhpJx0YiENiCzv3CdWiVoN2ZImAR4YVbq2Yj4DcZKue4xdv7zyRTWqOTqTRT5jvdii-re1ByI5zoZeI5aQzjwMJte3VEqaNbuLRy9iPpqnCMzMEewzDM3HMAIYvIZA==',
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

// /ingest — URL 인제스터 수동 명령
bot.command('ingest', async (ctx) => {
  const url = ctx.match?.trim();
  if (!url) {
    await ctx.reply('사용법: /ingest <URL>\n예: /ingest https://www.threads.net/@user/post/xxx');
    return;
  }
  await ctx.reply(`🔍 인제스트 중: ${url}`);
  try {
    const result = await ingestUrl({ url, source: InboundSource.MANUAL_TELEGRAM });
    await ctx.reply(
      `${result.isNew ? '✅' : 'ℹ️'} ${result.message}\n\n` +
        `Platform: ${result.platform}\n` +
        `Status: ${result.status}\n` +
        `Inbound ID: \`${result.inboundLinkId}\``,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.error(err, '/ingest failed');
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});

// 일반 메시지에 URL 있으면 자동 인제스트 (커맨드 아닌 텍스트만)
bot.on('message:text', async (ctx, next) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) {
    await next();
    return;
  }
  const urls = extractUrls(text);
  if (urls.length === 0) return;

  // 방식 1: "코드 URL" 일반 메시지 (텔레그램 답장 차단 회피 · 권장)
  //   예: "K42 https://link.coupang.com/a/..."
  const codeMatch = text.match(/^\s*([A-Za-z0-9]{4})\b/);
  if (codeMatch) {
    const { getPendingByCode, clearPendingByCode } = await import('./pending-match.js');
    const code = codeMatch[1]!.toUpperCase();
    const pending = await getPendingByCode(code);
    if (pending) {
      const commerceUrl = urls.find((u) => isCommerceUrl(u));
      if (!commerceUrl) {
        await ctx.reply(`⚠️ [${code}] 커머스 URL (쿠팡·무신사·네이버) 이 없어요.`);
        return;
      }
      await ctx.reply(`🔁 [${code}] 하이브리드 재실행: ${pending.accountHandle} · ${commerceUrl.slice(0, 50)}...`);
      try {
        const b = await prisma.benchmarkPost.findUnique({
          where: { id: pending.benchmarkPostId },
          select: { text: true, mediaUrls: true, permalink: true, inboundLinkId: true },
        });
        if (!b) { await ctx.reply('❌ 벤치마크 조회 실패'); return; }
        if (b.inboundLinkId) {
          await prisma.inboundLink.update({
            where: { id: b.inboundLinkId },
            data: { manualCommerceUrl: commerceUrl },
          }).catch((e) => logger.warn({ e }, 'manualCommerceUrl 저장 실패'));
        }
        const outcome = await runPipelineA({
          accountId: pending.accountId,
          sourceMediaUrls: b.mediaUrls,
          sourceText: b.text,
          sourceUrl: b.permalink,
          explicitCommerceUrl: commerceUrl,
        });
        if (outcome.status === 'PENDING_APPROVAL') {
          await ctx.reply(`✅ [${code}] 새 승인 카드 발송. 확인 후 승인/리젝 하세요.`);
          await clearPendingByCode(code);
        } else {
          await ctx.reply(`❌ [${code}] 재실행 실패: stage=${outcome.stage} · ${outcome.reason}`);
        }
      } catch (err) {
        logger.error({ err, code }, 'code-based pending 처리 실패');
        await ctx.reply(`❌ [${code}] 처리 실패: ${(err as Error).message}`);
      }
      return;
    }
    // 코드 매칭 실패 → 아래 일반 흐름으로 계속 (오탐 방지)
  }

  // 방식 2 (백업): 대기 카드에 답장으로 커머스 URL 던진 경우
  const replyToId = ctx.message.reply_to_message?.message_id;
  if (replyToId) {
    const { getPendingMatch, clearPendingMatch } = await import('./pending-match.js');
    const pending = await getPendingMatch(replyToId);
    if (pending) {
      const commerceUrl = urls.find((u) => isCommerceUrl(u));
      if (!commerceUrl) {
        await ctx.reply('⚠️ 답장에 커머스 URL (쿠팡·무신사·네이버) 이 없어요.');
        return;
      }
      await ctx.reply(`🔁 하이브리드 재실행: benchmarkId=${pending.benchmarkPostId.slice(0,8)} · ${commerceUrl.slice(0,60)}...`);
      try {
        const b = await prisma.benchmarkPost.findUnique({
          where: { id: pending.benchmarkPostId },
          select: { text: true, mediaUrls: true, permalink: true, inboundLinkId: true },
        });
        if (!b) { await ctx.reply('❌ 벤치마크 조회 실패'); return; }

        // InboundLink 에 manualCommerceUrl 저장 (다음 자동 실행에도 하이브리드로 잡히게)
        if (b.inboundLinkId) {
          await prisma.inboundLink.update({
            where: { id: b.inboundLinkId },
            data: { manualCommerceUrl: commerceUrl },
          }).catch((e) => logger.warn({ e }, 'manualCommerceUrl 저장 실패'));
        }

        const outcome = await runPipelineA({
          accountId: pending.accountId,
          sourceMediaUrls: b.mediaUrls,
          sourceText: b.text,
          sourceUrl: b.permalink,
          explicitCommerceUrl: commerceUrl,
        });
        if (outcome.status === 'PENDING_APPROVAL') {
          await ctx.reply(`✅ 새 승인 카드 발송 (post=${outcome.postId.slice(0,8)}). 확인 후 승인/리젝 하세요.`);
          await clearPendingMatch(replyToId);
        } else {
          await ctx.reply(`❌ 재실행 실패: stage=${outcome.stage} · ${outcome.reason}`);
        }
      } catch (err) {
        logger.error({ err }, 'pending-match reply 처리 실패');
        await ctx.reply(`❌ 처리 실패: ${(err as Error).message}`);
      }
      return;
    }
  }

  const { benchmarkUrls, commerceUrls } = splitBenchmarkAndCommerce(text);
  const supported = benchmarkUrls.filter((u) => detectPlatform(u) !== 'UNKNOWN');
  if (supported.length === 0) {
    const hint = commerceUrls.length > 0
      ? `\n\n⚠️ 커머스 URL(${commerceUrls.length}개)은 감지됐지만 붙일 벤치마크 URL(Threads/IG/TikTok/XHS) 이 없어요.`
      : '';
    await ctx.reply(`⚠️ 지원 벤치마크 URL을 찾지 못했습니다.\n감지된 URL: ${urls.length}개${hint}`);
    return;
  }
  const commerceNote = commerceUrls.length > 0
    ? ` (+ 커머스 URL ${commerceUrls.length}개 자동 페어링 · Product Matcher 스킵)`
    : '';
  await ctx.reply(`🔍 URL ${supported.length}개 자동 인제스트 시작...${commerceNote}`);
  const { results } = await ingestUrlsFromText(text, InboundSource.MANUAL_TELEGRAM);
  const summary = results
    .map(
      (r, i) =>
        `${i + 1}. ${r.isNew ? '✅' : 'ℹ️'} [${r.platform}] ${r.status}\n   ${r.message}`,
    )
    .join('\n\n');
  await ctx.reply(`📥 인제스트 결과 (${results.length}건)${commerceNote}\n\n${summary}`);
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

/**
 * 테스트 명령(/copy, /pa, /newpost)이 쓸 계정 선택.
 * 실 발행하지 않고 카피 · 승인카드 렌더링에만 사용.
 * dummy 계정 자동 생성 로직은 폐기됨 — 활성 계정 중 첫 번째 사용.
 */
async function getAnyActiveAccount() {
  const account = await prisma.account.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!account) {
    throw new Error('활성 Threads 계정이 없습니다. /oauth/threads/start 로 계정 연결 필요.');
  }
  return account;
}

bot.catch((err) => {
  logger.error({ err }, 'grammY error handler');
});
