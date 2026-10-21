---
name: feedback_small_edits_direct_not_subagent
description: 작은 수정은 서브에이전트+리뷰 세리머니 말고 직접 빠르게 (속도 중시)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c9e945a8-513e-4ad5-9c6f-252a5300845a
  modified: 2026-09-08T05:39:42.593Z
---

작고 국소적인 수정(프롬프트 한 줄, 파일 하나 편집, 설정값 변경 등)은 **컨트롤러가 직접 편집 + 빠른 확인(typecheck/1콜 테스트)**으로 처리한다. 구현 서브에이전트 → 리뷰 서브에이전트 → 실제 LLM 생성 검증까지 도는 풀 세리머니(subagent-driven-development)를 쓰지 말 것.

**Why:** 2026-09-08 사용자 항의 — 작은 프롬프트 수정 하나에 서브에이전트+리뷰+실LLM검증을 돌려서 5분짜리가 10분+ 걸렸고, "뭐하는데 이렇게 오래 걸리냐"며 두 번 중단시킴. 다단계 에이전트 오케스트레이션은 느리고 불투명하다.

**How to apply:** 큰/위험한 작업(신규 모듈, 다파일 통합, 마이그레이션, 되돌리기 어려운 것)에만 서브에이전트+리뷰를 쓴다. 작은 편집은 직접 Edit → `pnpm typecheck` 또는 최소 1콜 테스트(주제 1줄 뽑기 등, 전체 글 생성 X) → 커밋. 오래 걸리는 작업을 돌릴 땐 "이건 실제 LLM 호출이라 ~N초 걸립니다"처럼 소요·이유를 먼저 알려 투명하게. [[feedback_response_length]] [[feedback_execute_dont_gate]]
