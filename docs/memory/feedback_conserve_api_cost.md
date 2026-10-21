---
name: feedback_conserve_api_cost
description: 비용 최우선 절약 - 아직 수익이 안 나므로 불필요한 API/토큰 지출 최소화
metadata:
  node_type: memory
  type: feedback
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-18T01:27:03.619Z
---

**사용자: "제발 아껴쓰자. 지금 그만한 수익이 안나오고있잖아."** 프로젝트가 아직 수익이 안 나는 단계라 비용에 민감. Anthropic 크레딧을 소액($5~22)씩 충전하는데 백그라운드 크론이 금방 소진시켜 스트레스.

**How to apply:**
- 사람 트리거 없는 **자동 LLM 호출을 기본 금지** ([[project_auto_llm_crons_disabled]]). 새 기능·크론 추가 시 "이게 사람 트리거 없이 API를 도는가?" 먼저 자문.
- 내 작업 방식도 절약: 불필요한 재확인·장황한 탐색·중복 툴콜 줄이고, 백그라운드 스크립트도 한 번에 끝내게. 실측 검증은 하되([[feedback_verify_before_done]]) 최소 호출로.
- 모델 선택도 비용 고려 — 짧은 카피엔 haiku 검토 가치 있음(메인은 현재 claude-sonnet-5).
- 기능을 끌지 살릴지 애매하면, 비용 드는 쪽(자동 생성·태깅)을 끄는 방향으로 기본값. 발견·스크래핑(Apify)은 Anthropic과 무관하니 구분해서 판단.

**2026-10-13 (사용자 "최대한 아껴 써라"):** 스하리 생성 = Haiku + 간소화 프롬프트(입력 ~1.2k 토큰, 재시도 0). 소재 감시 판정은 Sonnet 유지(오독 위험) · 하루 6건 상한. 내 테스트도 계정 1개만.
