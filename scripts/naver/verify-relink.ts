import { prisma } from '../../src/db/prisma.js';
import { relinkNaverPost } from '../../src/modules/pipeline-d/relink/index.js';
import { NAVER_LEGAL_DISCLAIMER, type NaverPostDraft } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';
import { fetchProductInfo } from '../../src/infra/naver/smartstore-detail.js';

// 실측 가능한 스마트스토어 상품 URL이 있으면 여기에 넣어 눈으로 확인(없으면 스킵 — graceful fallback이 계약이므로 블로킹하지 않음).
const REAL_PRODUCT_URL = process.env.NAVER_VERIFY_REAL_PRODUCT_URL ?? '';

const minimalDraft: NaverPostDraft = {
  title: '겨울철 실내 습도 관리하는 법',
  intro: '겨울철 난방을 시작하면 실내 습도가 급격히 떨어져 피부와 호흡기 건강에 영향을 줍니다. 이 글에서는 실내 습도를 적정하게 유지하는 구체적인 방법을 소개합니다.',
  sections: [
    { heading: '적정 습도 기준', body: '실내 적정 습도는 40~60% 사이로 알려져 있습니다. 이보다 낮으면 피부 건조와 목 따가움이 심해지고, 너무 높으면 곰팡이·진드기 번식 우려가 있습니다. 계절별로 온도 변화가 크기 때문에 습도계를 두고 수시로 확인하는 습관이 중요합니다.' },
    { heading: '자연 가습 방법', body: '젖은 수건을 널어두거나 실내 식물을 배치하는 것만으로도 습도를 어느 정도 보완할 수 있습니다. 특히 화장실 문을 열어 두거나 빨래를 실내에서 건조하는 방법도 비용 없이 습도를 올리는 실용적인 방법입니다.' },
    { heading: '환기와의 균형', body: '가습만큼 중요한 것이 환기입니다. 하루 2~3회, 짧게라도 창문을 열어 실내 공기를 순환시키면 습도와 공기질을 동시에 관리할 수 있습니다. 환기 직후에는 온도가 떨어지므로 난방과 타이밍을 맞추는 것이 좋습니다.' },
  ],
  imageSlots: [
    { afterSection: 0, caption: '따뜻한 조명 아래 거실 창가에 놓인 온습도계를 정면에서 찍은 사진', kind: 'AI' },
    { afterSection: 1, caption: '햇살 드는 거실 창턱에 놓인 초록 화분과 젖은 수건을 함께 찍은 사진', kind: 'AI' },
    { afterSection: 2, caption: '아침 햇빛이 들어오는 거실 창문을 살짝 열어둔 모습을 안쪽에서 찍은 사진', kind: 'AI' },
  ],
  tags: ['실내습도', '겨울건강', '가습방법', '환기요령', '적정습도', '건조함관리'],
  disclaimer: NAVER_LEGAL_DISCLAIMER,
};

async function main() {
  const post = await prisma.naverPost.create({
    data: {
      state: 'PLANNED',
      kind: 'INFO',
      topic: '생활·인테리어 정보',
      category: '생활가전',
      title: minimalDraft.title,
      draftJson: minimalDraft as unknown as object,
      suggestedProduct: '가습기',
      imageUrls: [],
    },
  });
  console.log('created throwaway INFO post', post.id);

  try {
    const result = await relinkNaverPost(post.id, 'https://smartstore.naver.com/x/products/123');
    console.log('relinkNaverPost result', result);
    if ('error' in result) throw new Error(`relinkNaverPost returned error: ${result.error}`);
    if (!result.pageUrl.includes('/admin/naver/')) throw new Error(`pageUrl 형식 이상: ${result.pageUrl}`);

    const reloaded = await prisma.naverPost.findUnique({ where: { id: post.id } });
    if (!reloaded) throw new Error('재조회 실패');
    if (reloaded.kind !== 'AFFILIATE') throw new Error(`kind가 AFFILIATE로 안 바뀜: ${reloaded.kind}`);
    if (reloaded.connectUrl !== 'https://smartstore.naver.com/x/products/123') throw new Error(`connectUrl 반영 안 됨: ${reloaded.connectUrl}`);
    if (!reloaded.draftJson) throw new Error('draftJson 비어있음');
    // 합성/도달불가 URL이므로 fetchProductInfo는 {null,[]}을 반환해야 하고,
    // 그래도 productName 폴백 체인(suggestedProduct→title→...)이 살아서 kind/connectUrl/draftJson이 정상 반영됐어야 한다.
    if (!reloaded.title) throw new Error('title(=newDraft.title) 비어있음 — 폴백 체인 실패');

    console.log('OK: relink (실측)');
  } finally {
    await prisma.naverPost.delete({ where: { id: post.id } }).catch(() => {});
    console.log('cleaned up throwaway post', post.id);
  }

  if (REAL_PRODUCT_URL) {
    console.log('\n--- 실제 스마트스토어 URL로 fetchProductInfo 육안 확인 ---');
    const info = await fetchProductInfo(REAL_PRODUCT_URL, { maxImages: 6 });
    console.log('name:', info.name);
    console.log('images:', info.images);
    if (!info.name && info.images.length === 0) {
      console.log('NOTE: 실제 URL에서도 빈 결과 — 셀렉터 재확인 필요할 수 있음(그래도 폴백 계약은 유지됨)');
    }
  } else {
    console.log('\n(NAVER_VERIFY_REAL_PRODUCT_URL 미설정 — 실 URL 육안 확인 스킵, 폴백 계약 검증은 위에서 완료)');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
