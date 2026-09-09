import { z } from 'zod';

export const NAVER_LEGAL_DISCLAIMER =
  '본 포스팅은 네이버 쇼핑커넥트 활동의 일환으로, 구매 발생 시 일정액의 수수료를 제공받습니다.';

// 깜냥로그 표준 카테고리 (네이버 블로그 카테고리와 1:1). 모든 글은 이 중 하나로 배정된다.
export const NAVER_CATEGORIES = [
  '원룸·자취 인테리어',
  '레트로·뉴트로 주방',
  '정리수납·살림팁',
  '리빙템·가전 리뷰',
  '자취 생활정보',
] as const;
export type NaverCategory = (typeof NAVER_CATEGORIES)[number];

/** 임의 문자열/모델 출력/제목을 표준 카테고리 하나로 강제 매핑(항상 5개 중 하나 반환). */
export function normalizeNaverCategory(input?: string | null): NaverCategory {
  const s = (input ?? '').trim();
  if ((NAVER_CATEGORIES as readonly string[]).includes(s)) return s as NaverCategory;
  const t = s.replace(/[\s·]/g, '');
  if (t) {
    for (const cat of NAVER_CATEGORIES) {
      const key = cat.replace(/[\s·]/g, '');
      if (key.includes(t) || t.includes(key)) return cat;
    }
  }
  if (/주방|그릇|도마|포트|법랑|레트로|뉴트로|빈티지|식기|유리그릇/.test(s)) return '레트로·뉴트로 주방';
  if (/옷장|신발장|이불|수납|정리수납|옷\s*정리|살림/.test(s)) return '정리수납·살림팁';
  if (/버리는|폐기|무료\s*수거|배출|절약|전기세|생활비/.test(s)) return '자취 생활정보';
  if (/가전|리빙템|필수템|usb|USB|전자제품|메모리|이어폰|충전|뷰티|화장품/.test(s)) return '리빙템·가전 리뷰';
  if (/인테리어|원룸|방\s*꾸|자취방|소품|넓어|셀프/.test(s)) return '원룸·자취 인테리어';
  return '자취 생활정보';
}

export const NaverPostDraftSchema = z.object({
  title: z.string().min(4).max(80),
  intro: z.string().min(40),                 // 첫 문단(결론 먼저, ~200자 가중 구간)
  sections: z.array(z.object({
    heading: z.string().min(2).max(30),      // 소제목(제목2/3용)
    body: z.string().min(30),
  })).min(3),
  imageSlots: z.array(z.object({
    afterSection: z.number().int().min(0),   // 0 = intro 뒤
    caption: z.string(),
    kind: z.enum(['PRODUCT', 'AI']),
  })).min(3),
  tags: z.array(z.string()).min(5).max(10),
  disclaimer: z.string(),
  // 표준 카테고리 5개 중 하나(코드에서 정규화하여 강제 주입). 모델 출력에 의존하지 않음.
  category: z.string().optional(),
  // 문단별 제휴 링크 (LLM이 생성하는 게 아니라 /naverlink로 사후 부착. section=0은 intro 뒤, 1..N은 해당 소제목 뒤).
  sectionLinks: z
    .array(z.object({ section: z.number().int().min(0), url: z.string(), label: z.string().optional() }))
    .optional(),
});

export type NaverPostDraft = z.infer<typeof NaverPostDraftSchema>;
