---
name: feedback-execute-dont-gate
description: 설계 승인 후엔 단계마다 승인받지 말고 끝까지 실행하고 결과만 보고
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-06T04:52:37.355Z
---

설계/방향이 한 번 합의되면, **각 구현 단계마다 "진행할까요?"로 멈추지 말고 끝까지 실행하고 결과만 보고**하라.

**Why:** 사용자는 나를 신뢰하는 편이고, 방향 합의 후 게이트마다 확인하는 걸 답답해한다 ("자꾸 물어보지 말고 그냥 진행하면 안돼?"). 브레인스토밍/스펙 프로세스의 승인 게이트도 사용자 지시가 우선.

**How to apply:** 방향·설계는 처음에 합의(필요시 실측으로 검증). 그다음엔 남은 유닛/단계를 자율 실행하며 중간중간 **결과를 보고**(예측 아닌 실측). 되돌리기 어렵거나 외부 영향 있는 것(실발행·삭제·전송)만 확인. [[feedback_verify_before_done]] 는 유지 — 실행하되 실측으로 검증. [[feedback_no_silent_stopgap]] 도 유지 — 조용히 축소 X.
