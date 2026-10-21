---
name: project-shopping-propagation
description: "쇼핑 발행 설계 — 계정별 동일 콘텐츠 동시 발행 금지, 성과 게이팅 확산"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-06T23:42:00.767Z
---

쇼핑 콘텐츠는 **5계정에 같은 콘텐츠를 동시에 뿌리면 안 된다.** (2026-09-04 사용자 명시)

**설계 의도:** 한 계정에 먼저 발행 → 그 계정에서 반응이 좋으면 → 다른 계정에도 확산(성과 게이팅). 매일 좋아요순 top 벤치마크를 전 계정에 일괄 배포하는 방식은 금지.

**현재 상태:**
- 구 `SHOPPING_PUBLISH_CRON`(좋아요순 top 벤치마크 전 계정 일괄) = 여전히 정지 (removeRepeatable). 이게 "동일 콘텐츠 동시 배포" 금지 대상.
- **Line B(상품 우선) 자동 크론 = 가동 (2026-09-07)**: 5계정이 **각기 다른 시각**(KST 10:20·13:10·15:40·18:20·21:10)에 **1건씩**, **크로스계정 상품 dedup**(최근 3일 어느 계정이든 쓴 상품 제외)으로 **서로 다른 상품**. → "같은 상품·같은 시간 동시발행" 금지를 구조적으로 지킴. queue=LINE_B_PUBLISH, 잡=line-b-<accountId>. 수동 트리거 `/lineb`.
- Line B = 쿠팡 베스트셀러 → 미니세트(2~3) → API썸네일 미디어 → 큐레이션 카피(fact-check로 자녀·직업 노출 차단) → 고정댓글([광고]+마스킹링크N+공정위) → 승인카드. 상세페이지 스크래핑은 Access Denied라 API 썸네일만.
- Line A(사용자 URL 벤치마크) 흐름은 그대로 유지. 성과 게이팅 확산(본문조회 1만+)은 별도 구축됨([[project_shopping_propagation]] 성과루프).

**Voyage 참고:** Voyage API 는 결제수단 미등록으로 3 RPM·10K TPM 제한 (429). 스하리 배치가 계정 순회 시 RAG 자주 429 → fallback. 다양성은 avoid-recent(최근 본문 회피)가 주 동력.
