import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { llm } from '../../../infra/llm/index.js';
import type { LlmContentPart } from '../../../infra/llm/index.js';
import { generateImage } from '../../../infra/llm/gemini-image.js';
import { uploadBufferToCloudinary } from '../../../infra/cloudinary-client.js';
import { generateNaverPost } from '../naver-copywriter/index.js';
import { fetchAutocomplete } from '../../../infra/naver/autocomplete.js';

const MAX_AI_IMAGES = 3;

/**
 * 카테고리 라벨 → 사람들이 실제로 검색하는 "자연스러운 씨앗 검색어" 목록.
 * 라벨 그대로("레트로주방")는 자동완성이 얇아서, 실제 검색 표현으로 넓게 씨앗을 준다.
 * 매핑 없는 라벨은 라벨 자체를 씨앗으로 폴백.
 */
const CATEGORY_SEEDS: Record<string, string[]> = {
  레트로주방: ['레트로 주방', '주방 인테리어', '주방용품 추천', '주방 꾸미기'],
  인테리어소품: ['인테리어 소품', '방 꾸미기', '셀프 인테리어', '자취방 꾸미기'],
  생활가전: ['생활가전 추천', '주방가전 추천', '소형가전', '자취 필수 가전'],
  수납정리: ['수납정리', '정리수납', '집 정리', '작은방 수납'],
};

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

export async function generateInfoAngle(category: string, recentTitles: string[], searchTerms?: string[]): Promise<string> {
  const avoid = recentTitles.length ? `다음 최근 주제와 겹치지 말 것:\n- ${recentTitles.join('\n- ')}` : '';
  const system = '너는 한국 네이버 블로그 정보성 글의 주제(앵글)를 딱 한 줄로 제안하는 도구다. 상품 판매가 아니라 독자에게 유용한 정보 주제. 특정 상품명·브랜드명·모델번호·규격은 주제에 절대 포함시키지 않는다. 출력은 주제 한 줄만.';
  const searchInstruction = searchTerms && searchTerms.length
    ? `아래는 사람들이 네이버에 "${category}" 관련으로 실제로 검색하는 키워드들이다(자동완성/연관검색어 = 실제 검색 수요). 이 목록이 보여주는 "사람들의 실제 관심사"를 근거로, 사람들이 정보(방법·팁·비교·고르는 법·관리법 등)를 궁금해할 만한 주제를 골라 유용한 정보글 주제 한 줄로 만들어라.

실제 검색 키워드:
- ${searchTerms.join('\n- ')}

규칙:
- 이 키워드들이 반영하는 실제 관심사에서 출발하되, 특정 상품명·브랜드·모델명·규격은 주제에 넣지 마라.
- 상품명 나열이 아니라 "검색해서 읽고 싶은 정보 주제"로 만들어라.
- 예: 검색어 "옷 수납정리함", "좁은방 수납" → 주제 "좁은 방 옷 수납, 공간 두 배로 쓰는 정리법".`
    : '';
  const userParts: LlmContentPart[] = [
    { type: 'text', text: `블로그 주제 카테고리: ${category}\n검색 수요 있을 법한 정보성 글 주제 한 줄을 제안해라(제목 아님, 주제).\n${searchInstruction}\n${avoid}` },
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
    // 주제 = 사람들이 실제 검색하는 것에서. 카테고리별 자연스러운 씨앗어들로 자동완성을 넓게 긁는다.
    // 전부 실패하면 빈 배열 → generateInfoAngle 에버그린 폴백.
    const seeds = CATEGORY_SEEDS[category] ?? [category];
    const pools = await Promise.all(seeds.map((s) => fetchAutocomplete(s, { max: 8 })));
    const searchTerms = [...new Set(pools.flat())].slice(0, 30);
    angle = await generateInfoAngle(category, recentTitles, searchTerms);
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
