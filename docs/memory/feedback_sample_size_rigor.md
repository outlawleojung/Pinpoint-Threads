---
name: feedback_sample_size_rigor
description: 모수 작은 결과를 '모델·승자'로 일반화 금지 · 학습 코드화 전에 표본 크기 확인
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-20T23:54:54.596Z
---

**깨달은 인사이트를 프롬프트·시스템에 학습시킬 때, 표본이 작은 결과를 '승자 모델'로 일반화하지 마라.**

**Why:** 에우셉 스낵통의 댓글유입 64.7%를 "2차 KPI 승자"로 winning-style.ts에 few-shot·근거로 박았더니 사용자: "에우셉은 모수가 너무 작아서(17뷰) 모델로 잡는 건 의미가 없어." 17뷰 기반 비율은 노이즈 → 과적합.

**How to apply:**
- 카피·전략 규칙을 코드화(winning-style few-shot, 프롬프트 룰)하기 전에 **표본 크기부터 확인**. 조회 수십~수백 이상 등 최소 신뢰 구간 없으면 "승자"로 취급 X.
- 정직하게: 우리는 아직 **2차 KPI(댓글유입 ≥10%)를 유의미한 도달에서 한 번도 못 풀었다**(전부 1~5%). 방향(궁금증 미끼로 댓글 열기)은 **가설**로만 넣고, 유입 데이터가 쌓이면 검증 후 승격. 관련 [[project_performance_kpi]].
- 소수 사례 = 가설/관찰, 다수·재현 = 규칙. 이 구분을 지켜라.
