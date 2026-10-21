---
name: project_correction_learning_loop
description: 정정 학습 루프 — 승인 카드에 텔레그램 답장으로 정정하면 즉시 반영+학습돼 다음 글에 재사용됨
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-16T14:04:12.613Z
---

정정 학습 루프 (2026-09-16 Phase 1-3 구현·검증). 사용자가 매번 손으로 고치던 정정을 축적·재사용해 무수정 승인율을 올리는 것이 목표. vision의 "왜 터졌나 재생산"의 학습 측면.

**사용법 (사용자):** 승인 카드(버튼 있는 메시지)에 **텔레그램 답장**으로 자유 정정("옆사람이야" / "마무리 밋밋" / "동전 살려") → 그 카드가 정정 반영돼 즉시 재생성·재전송됨. 규칙 승인 대기 없음. 틀리면 또 답장으로 고치면 됨.

**동작:**
- 캡처: `applyCorrection`(approval-gate/service.ts) → CopyCorrection 저장 + 정정을 하드 제약(`correctionInstruction`)으로 재생성.
- 승인 시: 그 게시물 정정들 approvedFinal=true + resultingBody=승인본 (학습 정답).
- 재사용(Phase 3): 생성 시 `loadRecentCorrections`가 같은 contentKind(+카테고리) 승인 정정 지시를 few-shot 주입(copywriter). **본문 복붙 아님 · 지시 텍스트만**(나쁜 템플릿 재학습 방지).
- 멱등: 본문이 Post에 저장돼 옛 카드 승인해도 최신 본문 발행 → 스테일 위험 없음. cardVersion/correctionCount는 지표.

**모델:** CopyCorrection(정정 이력), CopyRule(Phase 4 규칙 승격·미구현). Post.cardVersion·correctionCount·approvedCardVersion.

**미구현:** Phase 4 = 반복 정정을 좁은 scope 규칙(CopyRule)으로 승격(사용자 승인 하). 스펙: docs/superpowers/specs/2026-09-09-correction-learning-loop-design.md. 관련 [[feedback_fix_from_source_not_patch]] [[project_reach_health_gate]]
