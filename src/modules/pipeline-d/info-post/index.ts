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
  const system = '너는 한국 네이버 블로그 정보성 글의 주제(앵글)를 딱 한 줄로 제안하는 도구다. 상품 판매가 아니라 독자에게 유용한 정보 주제. 특정 상품명·브랜드명·모델번호·규격은 주제에 절대 포함시키지 않는다. 출력은 주제 한 줄만.';
  const trendInstruction = trendKeyword
    ? `아래 "트렌드 신호"는 상품명이 아니라 "이런 영역에 대한 사람들의 관심이 커지고 있다"는 관심 신호일 뿐이다. 이 신호 자체(상품·브랜드·모델)를 글의 소재로 직접 쓰지 마라.

트렌드 신호: "${trendKeyword}"

절차:
1) 이 문자열에서 모델명·규격(예: 숫자 코드), 색상, "로고 인쇄" 같은 커스텀 옵션, 브랜드명·제품 라인명 등 특정 상품(SKU)을 특정하는 잡음을 모두 걷어내라.
2) 남는 것에서 사람들이 실제로 궁금해하는 "일반적인 필요·관심사"가 무엇인지 추론하라.
3) 그 관심사를 다루는, 사람들이 검색할 법한 "정보 주제" 한 줄을 제안하라(예: 활용법·고르는 기준·관리법·비교 등). 주제에는 특정 상품명·브랜드명·모델명·규격이 절대 등장하면 안 되며, 상품 리뷰·홍보 글 주제가 아니라 순수 정보글 주제여야 한다.

예시: 트렌드 신호 "매직캔 매직롤 280 화이트 로고 인쇄 리필" → (모델명 280·색상 화이트·로고 인쇄 등 잡음 제거) → 관심사: 쓰레기통 위생·냄새·리필 관리 → 주제: "쓰레기통 냄새 없이 관리하는 법"
(❌ 절대 금지 예: "매직캔 매직롤 280 리필 교체 주기"처럼 특정 상품명·모델명이 주제에 남는 것)`
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

  // 역할 분리(정책): 주제는 쿠팡 트렌드와 무관하게 LLM 에버그린으로 뽑는다
  // (쿠팡 = "뭐가 팔리나"지 "사람들이 뭘 찾아 읽나"가 아니므로 주제 신호로 부적합).
  // 쿠팡 상품(trend)은 오직 선택적 링크 후보(suggestedProduct)로만 남긴다.
  let trend: { id: string; keyword: string } | null = null;
  let angle: string;
  if (opts?.angleHint) {
    angle = opts.angleHint;
  } else {
    trend = await pickTrendKeyword(category); // 링크 후보용 (주제엔 사용하지 않음)
    angle = await generateInfoAngle(category, recentTitles);
  }

  const draft = await generateNaverPost({
    topic: cfg.topic,
    product: { name: angle },           // INFO: 상품 대신 앵글을 소재로 전달
    connectUrl: '',
    kind: 'INFO',
    extraNote: `카테고리: ${category}. 정보성 글. 특정 상품 판매 목적이 아니라 "${angle}" 주제를 유용하게 다룬다. 제휴 링크·상품 추천 없음. 제목과 본문에 특정 상품명·브랜드명·모델번호를 절대 언급하지 마라.`,
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
