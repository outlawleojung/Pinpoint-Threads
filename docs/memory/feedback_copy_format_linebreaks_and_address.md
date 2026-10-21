---
name: feedback_copy_format_linebreaks_and_address
description: "카피 포맷 — 긴 글은 한두 줄씩 묶어 빈 줄로 분리 · 독자 호칭은 '님들' 아닌 '스친들'"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-11T06:37:39.084Z
---

**줄바꿈:** 짧은 한두 줄 카피는 한 덩어리로 두되, **문장이 길면(3문장+) 의미 단위(감탄→반전→질문 등)로 한두 줄씩 묶고 그룹 사이에 빈 줄(`\n\n`)**을 넣어 가독성을 높인다. 한 줄로 죽 이어 쓰지 말 것.

**독자 호칭:** 독자를 부를 땐 "님들"이 아니라 **"스친들"**(스레드 친구). 예: "스친들은 어때?", "스친들 뭐 골라?".

**Why:** 사용자 요청 — "줄바꿈도 가독성에 도움 되거든, 두 줄씩 묶어 중간에 빈 줄" / "님들이 아니고 스친들". 자동 생성 카피가 한 줄로 길게 나오고 호칭을 "님들"로 쓰던 것 교정.

**How to apply:** `copywriter/index.ts` UNIVERSAL_PRINCIPLES 출력 포맷에 줄바꿈 규칙 + "스친들" 호칭 규칙 상주. body 안 줄바꿈은 `\n`. 관련 [[project_shopping_copy_hype_style]].
