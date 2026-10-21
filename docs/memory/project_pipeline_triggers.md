---
name: project-pipeline-triggers
description: 3개 파이프라인 텔레그램 트리거 방식 · 콘텐츠 자동 라우팅 안 됨(태그로 구분)
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-07T00:39:20.605Z
---

콘텐츠 타입 **자동 인지(쇼핑/일상/스하리) 안 됨.** 명시적으로 구분해서 보내야 함 (사용자 방침: 자동분류 X, 태그).

**텔레그램 입력 방식 (2026-09-07 기준):**
- **쇼핑(Line A)**: `{벤치마크URL} {상품명}` 또는 `{URL} {쿠팡링크}` → 매칭→승인카드. 실패 대기카드는 `{4자코드} {상품명/URL}`.
- **쇼핑(Line B, 상품우선)**: URL 불필요. `/lineb`(전계정)·`/lineb one`. 매일 자동 크론(계정별 다른 시각). 쿠팡 베스트셀러→미니세트.
- **일상글(Pipeline C)**: **`일상 {URL}`** 태그 또는 `/daily {URL}`. 상품·링크·고정댓글 없음. 영상 1개면 프레임 이미지 자동 추가(2장 룰).
- **스하리(Pipeline B)**: URL 없음. 자동 크론(트렌드 수집→각색).

**주의(코드 함정):** JS 정규식 `\b`는 한글에 안 먹음. 한글 토큰 뒤 경계는 `(?=[\s:：]|$)` 식으로. ([[feedback_verify_before_done]])

일상글은 쇼핑 벤치마크 풀 오염 방지 위해 ingestUrl(skipPromote:true)로 승격 스킵. 관련: [[project_shopping_propagation]]
