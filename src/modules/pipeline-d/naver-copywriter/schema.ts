import { z } from 'zod';

export const NAVER_LEGAL_DISCLAIMER =
  '본 포스팅은 네이버 쇼핑커넥트 활동의 일환으로, 구매 발생 시 일정액의 수수료를 제공받습니다.';

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
  // 문단별 제휴 링크 (LLM이 생성하는 게 아니라 /naverlink로 사후 부착. section=0은 intro 뒤, 1..N은 해당 소제목 뒤).
  sectionLinks: z
    .array(z.object({ section: z.number().int().min(0), url: z.string(), label: z.string().optional() }))
    .optional(),
});

export type NaverPostDraft = z.infer<typeof NaverPostDraftSchema>;
