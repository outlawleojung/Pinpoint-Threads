import { prisma } from '../../src/db/prisma.js';
import { buildInfoPost, pickTrendKeyword } from '../../src/modules/pipeline-d/info-post/index.js';

// naver-copywriter의 LLM 출력이 간헐적으로 zod 스키마(특히 imageSlots[].kind)를 누락하는
// 기존(본 태스크 범위 밖) 이슈가 있어, 배선 검증 자체가 그 불안정성 때문에 실패하지 않도록
// 검증 스크립트 레벨에서만 재시도한다. buildInfoPost 자체의 재시도 로직은 아님.
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[retry] ${label} 시도 ${i}/${attempts} 실패: ${(err as Error).message?.slice(0, 200)}`);
    }
  }
  throw lastErr;
}

async function main() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg || cfg.categories.length === 0) { console.error('SKIP: config/categories 없음 — seed-config 먼저'); process.exit(2); }
  const category = cfg.categories[0]!;

  // --- 1) 트렌드 키워드 있는 경우: buildInfoPost가 이를 소재로 삼고 usedAt을 찍는지 ---
  const seeded = await prisma.naverTrendKeyword.create({
    data: {
      category,
      keyword: '__verify_trend_keyword__',
      source: 'VERIFY_SCRIPT',
      value: 1e9, // orderBy value desc 에서 항상 최우선으로 뽑히도록
    },
  });

  try {
    const before = await pickTrendKeyword(category);
    if (!before || before.id !== seeded.id) throw new Error(`pickTrendKeyword가 시드 행을 반환하지 않음: ${JSON.stringify(before)}`);

    const out = await withRetry('buildInfoPost(trend)', () => buildInfoPost({ category }));
    console.log('built (trend path)', out);

    const post = await prisma.naverPost.findUnique({ where: { id: out.naverPostId } });
    if (!post || post.state !== 'PLANNED' || post.kind !== 'INFO') throw new Error('INFO PLANNED 저장 실패');
    if (post.suggestedProduct !== seeded.keyword) throw new Error(`suggestedProduct가 시드 키워드와 다름: ${post.suggestedProduct}`);
    if (out.suggestedProduct !== seeded.keyword) throw new Error(`buildInfoPost 반환값 suggestedProduct 불일치: ${out.suggestedProduct}`);

    const updated = await prisma.naverTrendKeyword.findUnique({ where: { id: seeded.id } });
    if (!updated?.usedAt) throw new Error('트렌드 키워드 usedAt이 마킹되지 않음 (트렌드 경로 미사용)');

    console.log('OK: info trend wiring (실측)');
  } finally {
    await prisma.naverTrendKeyword.delete({ where: { id: seeded.id } }).catch(() => {});
  }

  // --- 1b) 잡음 섞인 SKU 스타일 트렌드 키워드: 주제가 상품 자체로 흘러가지 않는지(콘텐츠 품질) ---
  const noisyCategory = '수납정리';
  const noisyKeyword = '매직캔 매직롤 280 화이트 로고 인쇄 리필';
  const noisySeeded = await prisma.naverTrendKeyword.create({
    data: { category: noisyCategory, keyword: noisyKeyword, source: 'VERIFY_SCRIPT', value: 1e9 },
  });

  const NOISE_TOKENS = ['매직캔', '매직롤', '280', '로고 인쇄'];
  let noisyPostId: string | null = null;
  try {
    const noisyOut = await withRetry('buildInfoPost(noisy trend)', () => buildInfoPost({ category: noisyCategory }));
    noisyPostId = noisyOut.naverPostId;
    console.log('built (noisy trend path) — title:', noisyOut.title);

    const noisyPost = await prisma.naverPost.findUnique({ where: { id: noisyOut.naverPostId } });
    if (!noisyPost || noisyPost.state !== 'PLANNED' || noisyPost.kind !== 'INFO') throw new Error('잡음 트렌드 경로 INFO PLANNED 저장 실패');
    if (noisyPost.suggestedProduct !== noisyKeyword) throw new Error(`잡음 트렌드: suggestedProduct가 시드 키워드와 다름: ${noisyPost.suggestedProduct}`);
    if (noisyOut.suggestedProduct !== noisyKeyword) throw new Error(`잡음 트렌드: buildInfoPost 반환값 suggestedProduct 불일치: ${noisyOut.suggestedProduct}`);

    const title = noisyOut.title ?? '';
    if (!title.trim()) throw new Error('잡음 트렌드: 생성된 제목이 비어있음');
    const titleLower = title.toLowerCase();
    for (const token of NOISE_TOKENS) {
      if (titleLower.includes(token.toLowerCase())) {
        throw new Error(`잡음 트렌드: 제목에 SKU 잡음 토큰("${token}")이 남아있음 — 상품 홍보글화됨: "${title}"`);
      }
    }
    if (noisyPost.title !== title) throw new Error(`잡음 트렌드: draft.title과 buildInfoPost 반환 title 불일치: "${noisyPost.title}" vs "${title}"`);

    console.log(`OK: 잡음 SKU 트렌드 → 일반 정보 주제로 추상화됨. title="${title}"`);
  } finally {
    await prisma.naverTrendKeyword.delete({ where: { id: noisySeeded.id } }).catch(() => {});
    if (noisyPostId) await prisma.naverPost.delete({ where: { id: noisyPostId } }).catch(() => {});
  }

  // --- 2) 트렌드 키워드 없는 카테고리: 기존 폴백(LLM 앵글 생성) 동작 유지 확인 ---
  const fallbackCategory = '__verify_no_trend_category__';
  const noTrend = await pickTrendKeyword(fallbackCategory);
  if (noTrend) throw new Error('폴백 카테고리에 예기치 않은 트렌드 키워드가 존재함');

  const fallbackOut = await withRetry('buildInfoPost(fallback)', () => buildInfoPost({ category: fallbackCategory }));
  const fallbackPost = await prisma.naverPost.findUnique({ where: { id: fallbackOut.naverPostId } });
  if (!fallbackPost || fallbackPost.state !== 'PLANNED' || fallbackPost.kind !== 'INFO') throw new Error('폴백 경로 INFO PLANNED 저장 실패');
  if (fallbackPost.suggestedProduct !== null) throw new Error(`트렌드 없는 폴백인데 suggestedProduct가 설정됨: ${fallbackPost.suggestedProduct}`);
  if (fallbackOut.suggestedProduct !== null) throw new Error(`buildInfoPost 반환값 suggestedProduct가 null이 아님(폴백): ${fallbackOut.suggestedProduct}`);
  console.log('OK: info trend fallback (실측)');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
