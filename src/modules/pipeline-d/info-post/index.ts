import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { generateImage } from '../../../infra/llm/gemini-image.js';
import { uploadBufferToCloudinary } from '../../../infra/cloudinary-client.js';
import { generateNaverPost } from '../naver-copywriter/index.js';

const MAX_AI_IMAGES = 3;

export async function pickNextCategory(): Promise<string> {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg || cfg.categories.length === 0) throw new Error('NaverBlogConfig.categories 비어있음 — seed-config 실행');
  const recent = await prisma.naverPost.findMany({
    where: { kind: 'INFO', category: { not: null } },
    orderBy: { createdAt: 'desc' }, take: cfg.categories.length * 2, select: { category: true },
  });
  const counts = new Map<string, number>(cfg.categories.map((c) => [c, 0]));
  for (const r of recent) if (r.category && counts.has(r.category)) counts.set(r.category, counts.get(r.category)! + 1);
  // 사용 빈도 최소 카테고리(동률이면 categories 순서 우선)
  return cfg.categories.reduce((best, c) => (counts.get(c)! < counts.get(best)! ? c : best), cfg.categories[0]!);
}

export async function generateInfoAngle(category: string, recentTitles: string[], trendKeyword?: string): Promise<string> {
  const avoid = recentTitles.length ? `다음 최근 주제와 겹치지 말 것:\n- ${recentTitles.join('\n- ')}` : '';
  const system = '너는 한국 네이버 블로그 정보성 글의 주제(앵글)를 딱 한 줄로 제안하는 도구다. 상품 판매가 아니라 독자에게 유용한 정보 주제. 출력은 주제 한 줄만.';
  const trendInstruction = trendKeyword
    ? `지금 뜨고 있는 상품·키워드는 "${trendKeyword}"다. 이 키워드를 직접적인 판매·홍보 없이, 이 키워드와 자연스럽게 연결되는 유용한 정보성 주제로 녹여내라(예: 활용법·비교·고르는 기준·관리법 등). 주제 문장에 이 키워드 또는 그 상품군이 드러나야 한다.`
    : '';
  const userParts: LlmContentPart[] = [
    { type: 'text', text: `블로그 주제 카테고리: ${category}\n검색 수요 있을 법한 정보성 글 주제 한 줄을 제안해라(제목 아님, 주제).\n${trendInstruction}\n${avoid}` },
  ];

  const result = await llm().complete({
    tier: 'main',
    system,
    userParts,
    temperature: 0.9,
    maxOutputTokens: 200,
    thinking: 'disabled',
  });

  return result.text.trim().replace(/^["'\-\s]+|["'\s]+$/g, '').split('\n')[0]!;
}

/** 미사용 트렌드 키워드 중 해당 카테고리에서 신호가 가장 강한 1건 (없으면 null). */
export async function pickTrendKeyword(category: string): Promise<{ id: string; keyword: string } | null> {
  const row = await prisma.naverTrendKeyword.findFirst({
    where: { category, usedAt: null },
    orderBy: [{ value: 'desc' }, { collectedAt: 'desc' }],
  });
  return row ? { id: row.id, keyword: row.keyword } : null;
}

export async function buildInfoPost(opts?: { category?: string; angleHint?: string }): Promise<{ naverPostId: string; title: string; category: string; suggestedProduct: string | null }> {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg) throw new Error('NaverBlogConfig 없음');
  const category = opts?.category ?? (await pickNextCategory());

  const recentTitles = (await prisma.naverPost.findMany({
    where: { kind: 'INFO', category }, orderBy: { createdAt: 'desc' }, take: 8, select: { title: true },
  })).map((p) => p.title).filter((t): t is string => !!t);

  let trend: { id: string; keyword: string } | null = null;
  let angle: string;
  if (opts?.angleHint) {
    angle = opts.angleHint;
  } else {
    trend = await pickTrendKeyword(category);
    angle = await generateInfoAngle(category, recentTitles, trend?.keyword);
  }

  const draft = await generateNaverPost({
    topic: cfg.topic,
    product: { name: angle },           // INFO: 상품 대신 앵글을 소재로 전달
    connectUrl: '',
    kind: 'INFO',
    extraNote: `카테고리: ${category}. 정보성 글. 특정 상품 판매 목적이 아니라 "${angle}" 주제를 유용하게 다룬다. 제휴 링크·상품 추천 없음.`,
  });

  // INFO 보조 이미지 (AI 슬롯만, 상한). 상품 실물 없음.
  const aiSlots = draft.imageSlots.filter((s) => s.kind === 'AI').slice(0, MAX_AI_IMAGES);
  const imageUrls: string[] = [];
  for (const slot of aiSlots) {
    try {
      const { data, mimeType } = await generateImage(`네이버 블로그 정보성 글 보조 이미지(일러스트/그래픽, 실물 사진 아님). 주제: ${cfg.topic} · ${category}. 내용: ${slot.caption}`);
      imageUrls.push(await uploadBufferToCloudinary(data, mimeType));
    } catch (err) {
      logger.warn({ err: (err as Error).message, caption: slot.caption }, 'INFO AI 이미지 실패, 스킵');
    }
  }

  const suggestedProduct = trend?.keyword ?? null;

  const post = await prisma.naverPost.create({
    data: {
      state: 'PLANNED', kind: 'INFO', topic: cfg.topic, category, title: draft.title,
      draftJson: draft as unknown as object, imageUrls, suggestedProduct,
    },
  });

  if (trend) {
    await prisma.naverTrendKeyword.update({ where: { id: trend.id }, data: { usedAt: new Date() } });
  }

  return { naverPostId: post.id, title: draft.title, category, suggestedProduct };
}
