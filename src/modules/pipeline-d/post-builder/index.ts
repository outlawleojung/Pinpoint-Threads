import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { parseShoppingConnectLink } from '../../../infra/naver/shopping-connect-link.js';
import { resolveConnectUrl, fetchProductImages } from '../../../infra/naver/smartstore-detail.js';
import { NaverShoppingAdapter } from '../../../infra/commerce/naver-shopping-client.js';
import { generateImage } from '../../../infra/llm/gemini-image.js';
import { uploadBufferToCloudinary } from '../../../infra/cloudinary-client.js';
import { generateNaverPost } from '../naver-copywriter/index.js';

const MAX_AI_IMAGES = 3;       // Global Constraint: AI 이미지 도배 금지
const RECENT_WINDOW = 10;

export async function affiliateRatioExceeded() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  const targetRatio = cfg?.affiliateRatio ?? 0.3;
  const recentPosts = await prisma.naverPost.findMany({
    orderBy: { createdAt: 'desc' }, take: RECENT_WINDOW, select: { kind: true },
  });
  const recent = recentPosts.length;
  const affiliate = recentPosts.filter((p) => p.kind === 'AFFILIATE').length;
  const ratio = recent === 0 ? 0 : affiliate / recent;
  return { exceeded: ratio > targetRatio, recent, affiliate, ratio };
}

export async function buildNaverPost(input: { connectUrl: string; extraNote?: string; kind?: 'INFO' | 'AFFILIATE' }) {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg) throw new Error('NaverBlogConfig 없음 — Admin에서 주제 설정 먼저');
  const kind = input.kind ?? 'AFFILIATE';

  // 1) 링크 해석
  const parsed = parseShoppingConnectLink(input.connectUrl);
  const finalUrl = parsed.productUrl ?? (await resolveConnectUrl(input.connectUrl));
  const reparsed = parsed.productId ? parsed : parseShoppingConnectLink(finalUrl);

  // 2) 상품 데이터 보강 (쇼핑검색 API)
  const adapter = new NaverShoppingAdapter(env.NAVER_CLIENT_ID ?? '', env.NAVER_CLIENT_SECRET ?? '');
  let product = reparsed.productId
    ? (await adapter.search(reparsed.productId).catch(() => []))[0] ?? null
    : null;
  // productId 검색이 비면 상세페이지 제목으로 재검색은 생략(초기) — 최소 정보로 진행
  const productName = product?.productName ?? '상품';
  const officialImages = (await fetchProductImages(reparsed.productUrl ?? finalUrl, { max: 6 }));
  const thumb = product?.thumbnailUrl ? [product.thumbnailUrl] : [];
  const productImageUrls = officialImages.length ? officialImages : thumb;

  // 3) 원고 생성
  const draft = await generateNaverPost({
    topic: cfg.topic,
    product: { name: productName, price: product?.price, category: product?.category },
    connectUrl: input.connectUrl,
    kind,
    extraNote: input.extraNote,
  });

  // 4) AI 보조 이미지 생성 (AI 슬롯 수만큼, 상한 MAX_AI_IMAGES)
  const aiSlots = draft.imageSlots.filter((s) => s.kind === 'AI').slice(0, MAX_AI_IMAGES);
  const aiImageUrls: string[] = [];
  for (const slot of aiSlots) {
    try {
      const { data, mimeType } = await generateImage(
        `네이버 블로그 보조 이미지, 실물 사진 아님(일러스트/그래픽). 주제: ${cfg.topic}. 내용: ${slot.caption}`,
      );
      const url = await uploadBufferToCloudinary(data, mimeType);
      aiImageUrls.push(url);
    } catch (err) {
      logger.warn({ err: (err as Error).message, caption: slot.caption }, 'AI 이미지 생성 실패, 스킵');
    }
  }

  // 5) 이미지 배열 = 공식(PRODUCT) 우선 + AI 보조. 순서는 패키지 렌더러가 슬롯에 배정.
  const imageUrls = [...productImageUrls, ...aiImageUrls];

  // 6) 저장
  let productRow = null;
  if (product) {
    productRow = await prisma.naverProduct.create({
      data: {
        externalId: product.externalId, productName: product.productName, productUrl: product.productUrl,
        connectUrl: input.connectUrl, thumbnailUrl: product.thumbnailUrl, price: product.price ?? null,
        imageUrls: productImageUrls,
      },
    });
  }
  const post = await prisma.naverPost.create({
    data: {
      state: 'PLANNED', kind, topic: cfg.topic, title: draft.title,
      draftJson: draft as unknown as object, connectUrl: input.connectUrl,
      imageUrls, productId: productRow?.id ?? null,
    },
  });

  const ratio = await affiliateRatioExceeded();
  const ratioWarning = kind === 'AFFILIATE' && ratio.exceeded
    ? `⚠️ 최근 ${ratio.recent}개 중 제휴 ${ratio.affiliate}개(${Math.round(ratio.ratio * 100)}%) — 목표 상한 초과. 정보성 글 권장.`
    : null;

  return { naverPostId: post.id, title: draft.title, ratioWarning };
}
