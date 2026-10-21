---
name: feedback_naver_engaging_not_dry
description: 네이버 글은 사전형 정보나열 금지 · 공감·문제해결·읽는 재미가 우선
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c9e945a8-513e-4ad5-9c6f-252a5300845a
  modified: 2026-09-09T00:26:31.998Z
---

네이버 블로그 글은 "정보 나열"이면 실패. 사람들이 읽고 싶고 궁금해서 클릭하고, 다 읽으면 자기 문제가 풀리는 글이어야 한다.

**Why:** 정보성 우선([[project_naver_info_post_is_information_first]])이라도 위키·교과서 톤이면 가독성·체류가 떨어져 홈피드/체류 알고리즘에 불리하고 애초에 안 읽힌다.

**How to apply:** 카피라이터 SYSTEM 프롬프트(`src/modules/pipeline-d/naver-copywriter/index.ts`)에 목적/목소리/후킹/재미 지시를 SEO 규칙보다 앞에 둔다. 구어체 공감("저도 그랬어요") → 구체 숫자·예시 → "그래서 이렇게" 결론. 위키식 정의 나열·광고 카피 톤·이모지 남발 금지. `scripts/naver/verify-tone.ts`로 실측 확인.
