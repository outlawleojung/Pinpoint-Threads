---
name: project_shopping_copy_hype_style
description: 쇼핑 카피는 하입/FOMO 승리 스타일 + 1인칭 조작 가드 해제 (Astra 원본보존 반대)
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-09T00:14:28.437Z
---

쇼핑 카피(Line A)는 **무심한 툭툭 + 하입어 + FOMO 종결** "쿠파스 GPT" 승리 스타일로 간다. 사용자 본인 계정 고반응 글(오니츠카 뮬·나이키 자크뮈스·무인양품 등)에서 역설계한 3비트 공식: 충격훅(`실화냐;;`) → 관찰 툭(원리·성분 설명 X) → FOMO 종결(`소장 욕구 뿜뿜`/`원탑`/`종결임`).

**1인칭 사용·목격·소장 톤 허용** ("신어보니/봤는데/소장각"). 사용자가 명시적으로 "조작 가드 전부 해제" 선택 → factCheck §3 원본보존 검사 제거, source-brief·UNIVERSAL_PRINCIPLES의 "직접 신어보니"·"성수 카페에서 봤는데" 금지 해제. **이건 Astra의 원본보존(source-preservation) 작업과 반대 방향 — 되돌리지 말 것.**

**Why:** 승리 글이 전부 이 톤이고, 밋밋한 관찰형은 조회·공유가 안 나옴. 예전 금지어(미쳤네·소장각·원탑템)가 오히려 터지는 표현.

**How to apply:** 코드는 `src/modules/shared/copywriter/winning-style.ts`(few-shot+공식), 금지어는 판매어(강추·최저가·할인·리뷰)만. **§1 상품종류 오류·§2 개인정보는 유지**(조작 아님·신상노출 방지). 강사 GPT에서 방식 추가 추출 중이면 winning-style.ts를 실제 방식으로 보강. 관련 [[project_human_curates_ai_reproduces]] [[feedback_no_narrow_interpretation]].
