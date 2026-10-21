---
name: feedback-publish-via-telegram-card
description: "발행은 항상 텔레그램 승인 카드로 컨펌받고 — \"발행해줘\"라고 해도 직접 APPROVED·큐 넣지 말고 카드 발송 (2026-10-06)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-10-06T00:25:21.491Z
---

모든 발행(일상·스하리·쇼핑·재탕)은 텔레그램 승인 카드를 보내고 사용자가 카드에서 승인한 뒤 나가게 한다. 여기 채팅에서 문구를 고른 뒤 "발행해줘"라고 해도 직접 state=APPROVED·publishQueue 투입 금지 — sendApprovalRequest 로 카드만 보낸다.

**Why:** 2026-10-06 sookck 일상글을 "2번으로 발행해줘"에 카드 없이 바로 발행했더니 사용자: "앞으로는 텔레그램에서 컨펌을 받고 발행하자." (10/3 스하리 자동 예약도 카드 없이 나갔고 연속 스하리 문제가 생김)

**How to apply:** 문구 확정 → generatedBody 반영 → sendApprovalRequest(postId). 예약·시차는 카드 승인 시 approval-gate 가 계산. 관련: [[project-publish-pacing]], [[feedback-execute-dont-gate]]
