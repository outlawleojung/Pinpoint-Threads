---
name: project-human-curates-ai-reproduces
description: "운영 모델 확정 — 사람이 콘텐츠 판단·큐레이션, AI는 재생산·확장. 완전자율 상품선정 OFF"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-07T01:54:47.324Z
---

**확정 운영 모델 (2026-09-07 사용자 결론: "자동은 AI가 제대로 일을 못한다"):**

- **사람(사용자) = 판단·큐레이션**: 뭐가 좋은/팔리는 콘텐츠인지 골라 URL을 던진다. AI가 못하는 영역.
- **AI = 재생산·확장**: 던져진 검증된 소스를 5페르소나 각색·상품매칭·카피/고정댓글·발행·성과추적·확산. AI가 잘하는 영역.

이게 vision.md 핵심("자동화가 아니라 터진 글의 '왜 터졌나'를 재생산")과 일치.

**적용:**
- 쇼핑 Line A(사용자 URL 벤치마크) · 일상글 C(사용자 URL) · 스하리 B(수집 벤치마크 각색) = AI 자동 재생산 ✅
- 트렌드 다이제스트 = 사람에게 **아이디어 제안**만(자동 발행 X)
- **Line B(상품 우선·완전자율 상품선정) = OFF 유지** (LINE_B_AUTO_ENABLED=false). 이유: 쿠팡 API는 밋밋한 카탈로그 이미지뿐 → 팔리는 미디어 없음 → AI가 스스로 상품·콘텐츠 판단하면 산만·저품질. 실측으로 확인(3상품 산만·생성카드 안 팔림·상세 스크래핑 차단).

관련: [[project_pipeline_triggers]] · [[project_shopping_propagation]]
