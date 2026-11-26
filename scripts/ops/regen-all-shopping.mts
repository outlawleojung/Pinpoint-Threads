import { prisma } from '../../src/db/prisma.js';
import { generateCustomBody } from '../../src/modules/shared/copywriter/index.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const COPY_RULE = `
★ 금지:
- 모델명 금지 (모델 이름 절대 X)
- 사진으로 보이는 외형 묘사 금지 (색감·소재·디자인)
- "사고쳤네", "일냈네" 같은 뻔한 광고 패턴 금지
- 원작자 정황 재연 금지
- ★★ 원본 표현·문장구조·키워드 재사용 절대 금지. 원본과 1%라도 비슷하면 표절이다 ★★
★ 허용·필수:
- 브랜드명 OK
- 상품 장점·특징 OK (편하다, 가볍다 — 사진으로 안 보이는 것)
- 교묘하게 광고 아닌 듯 광고. 자연스러운 후기 톤
- 쓰레드 말투 (반말, ㅋㅋ, ;;)
- 완전히 새로운 각도와 표현으로 써라
`.trim();

// 오늘 만든 PENDING_APPROVAL 쇼핑 포스트 전부
const posts = await prisma.post.findMany({
  where: {
    kind: 'SHOPPING',
    state: 'PENDING_APPROVAL',
    createdAt: { gte: new Date(Date.now() - 6 * 3600000) },
  },
  include: { account: true, sourceItem: true, commerceProduct: true },
  orderBy: { createdAt: 'asc' },
});

console.log(`=== 재생성 대상: ${posts.length}건 ===`);

// 각 포스트별 힌트
const hints: Record<string, string> = {
  '헌터': '헌터 레인부츠 — 방수력 좋고 튼튼함',
  '아디다스': '아디다스 슬리퍼 — 가죽에 3선, 혁신적',
  '에어포스': '나이키 에어포스 — 클래식 스니커즈, 편함',
  '에포스': '나이키 에어포스 — 클래식 스니커즈, 편함',
  '뉴발': '뉴발란스 로퍼 — 에어 쿠셔닝 내장, 걸어도 안 아픔',
  '브루클린': '나이키 브루클린 부츠 — 편하고 예쁨',
  '로퍼에 에어': '나이키 에어 로퍼 — 에어맥스급 착화감',
  '아식스': '아식스 러닝화 — 밑창 튼튼, 발바닥 편함',
};

// 톤 다양화
const tones = [
  '충동구매 후기 톤 — 샀는데 후회 없음',
  '친구한테 추천하는 톤 — 야 이거 진짜 좋다',
  '며칠 신어본 솔직 후기 톤',
  '우연히 발견한 느낌 — 이런게 있었어?',
  '오래 고민하다 질렀는데 대만족',
  '다른 사람 추천으로 삼 — 추천한 사람 감사',
  '재구매 고민 중 톤 — 또 사야 하나',
  '선물받았는데 예상 밖으로 좋음',
  '계절 바뀌면서 꺼냈는데 역시 좋음',
  '하나 더 사고 싶은 톤',
  '지인이 뭐 신었냐고 물어봄',
  '매장에서 발견하고 바로 결제',
];

let toneIdx = 0;
for (const post of posts) {
  const body = post.generatedBody ?? '';
  const handle = post.account.handle;

  // 힌트 결정
  let hint = '쇼핑 소재';
  for (const [key, val] of Object.entries(hints)) {
    if (body.includes(key)) { hint = val; break; }
  }

  const tone = tones[toneIdx % tones.length];
  toneIdx++;

  const direction = `${hint}\n톤: ${tone}\n${COPY_RULE}`;

  console.log(`\n--- ${handle} | ${post.id.slice(-8)} | 기존: ${body.slice(0, 50)}...`);

  try {
    const result = await generateCustomBody({
      direction,
      personaPrompt: post.account.personaPrompt ?? undefined,
      accountSeed: post.account.handle,
      accountId: post.account.id,
      sourceText: post.sourceItem?.rawText ?? undefined,
      sourceImageUrl: (post.mediaUrls?.[0]) ?? undefined,
      withReplyLead: Boolean(post.generatedReply),
    });

    // 기존 reply에서 링크 부분은 유지하고 replyLead만 교체
    let newReply = post.generatedReply;
    if (result.replyLead && post.generatedReply) {
      const lines = post.generatedReply.split('\n');
      lines[0] = result.replyLead;
      newReply = lines.join('\n');
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        generatedBody: result.body,
        generatedReply: newReply,
        cardVersion: { increment: 1 },
      },
    });

    console.log(`✅ 새 카피: ${result.body.replace(/\n/g, ' / ').slice(0, 120)}`);

    // 카드 재발송
    await sendApprovalRequest(post.id);
    console.log(`📨 카드 재발송`);
  } catch (err) {
    console.log(`❌ 실패: ${(err as Error).message.slice(0, 100)}`);
  }
}

console.log('\n✅ 전체 재생성 완료.');
await prisma.$disconnect();
process.exit(0);
