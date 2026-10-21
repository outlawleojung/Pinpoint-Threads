---
name: project_shopping_min_followers
description: 링크(수익화) 글은 팔로워 300 미만 계정 금지(하드 바닥) · 300 미만은 링크 없이 일상글로 · 300+도 도달 게이트 통과 필요
metadata:
  node_type: memory
  type: project
  modified: 2026-09-29T23:38:19.833Z
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
---

**팔로워 300 미만 계정은 링크(쿠팡 등) 글 금지 — 링크 없이 일상글로 간다** (사용자 결정 2026-09-30). 300 이상이어도 도달 게이트(중앙값≥150 또는 최근 1천뷰+ 이력)를 통과해야 링크 가능.

**Why:** 3분 스레드 강의 11개 전부가 가장 강하게 금지 — "300명 전 수익화 글 올린 계정은 한 달 뒤 아이디 사라져 있다". 이전엔 도달 기반 게이트만이라 kle0(118)·minyoung(183)도 쇼핑 발행 중이었음. 강의 방식: 300 미만은 쿠파스 글을 링크만 빼고 올려 반응 테스트 + 발행량 유지.

**How to apply:** 단일 진입점 `reach-health.ts` `isShoppingEligible`(LINK_MIN_FOLLOWERS=300 하드 바닥) → 신규 쇼핑(orchestrator·bot pickLeastUsedAccount)·확산(propagation-planner)·재탕 이관(repost-planner) 전부 이걸 씀. 최종 안전망: `publisher/index.ts`가 SHOPPING & 팔로워<300이면 고정댓글(링크) 생략 + kind→DAILY. 재탕 원 계정이 300 미만이면 "링크 없이 일상글로" 재탕. 승인 카드에 "🚫 고정댓글 발행 안 함" 표시. 기준 바꾸려면 LINK_MIN_FOLLOWERS 하나만. [[project_reach_health_gate]] [[project_course_strategy]]
