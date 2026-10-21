---
name: project_auto_llm_crons_disabled
description: 2026-09-18 API 비용 절감 - 백그라운드 자동 LLM 크론 전부 정지 · 사람 트리거+위너게이팅만 유지
metadata:
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-18T01:22:57.903Z
---

**2026-09-18: 프로젝트 Anthropic API 크레딧이 소진(`credit balance is too low`)돼서, 사용자 지시로 "불필요한 API 호출 전부 삭제".** 원인은 사용자 수동 발행이 아니라 **백그라운드 크론이 매일 계정별로 LLM 카피를 자동 생성**한 것.

**정지한 반복 크론** (`src/pipeline/trend-workers.ts` `scheduleTrendJobs`에서 `.add`→`removeRepeatable` 전환):
- trend-poll-daily, trend-search-daily(자동 검색+인제스트+태깅/분류 LLM), sharing-publish-daily(스하리 자동 카피), naver-trend-collect-daily, naver-daily-info-daily(네이버 정보글 자동 카피). (이전에 이미 꺼진 것: trend-digest, shopping-publish, Line B auto)

**유지**: `account-metrics-sync-daily`(LLM 없음·팔로워/나이 갱신, 발행 게이팅 필수) · **`sharing-collect-daily`**(스하리 상대 발견에 필요 · 스크래핑은 Apify=Anthropic 무관. 단 수집 글의 viralfactors LLM 태깅은 `sharing-collector`의 `VIRALFACTORS_TAG_ENABLED=false`로 꺼서 크레딧 0) · 이벤트성 publish/스냅샷 큐 · **성과게이팅 확산 sweep**(`runPropagationSweep`, 72h 스냅샷 후 `planPropagation`이 DB지표로 위너 판정 → **확정 위너 있을 때만** generateCopy. LLM은 위너일 때만 = 낭비 아님, 의도된 기능).

**적용 시점: 앱(워커) 재시작 시** `scheduleTrendJobs`가 removeRepeatable 실행 → 그때 반영. 재활성은 해당 removeRepeatable을 원래 `.add`로 되돌리면 됨.

**남은 정상 경로(사람 트리거)**: 텔레그램 URL 커스텀 발행([[project_human_curates_ai_reproduces]]), 정정 학습 루프([[project_correction_learning_loop]]), /lineb 수동. 크레딧 충전 전까지 이 경로들도 카피 생성이 막히니, 급하면 수기 카피로 대체. 모델=claude-sonnet-5(메인)/haiku(팩트체크).

**예외 (2026-10-12 사용자 결정 "자동화가 하나도 안 돼서 짜증"):** 소재 감시 크론(source-watch, 매일 08:20)은 켬 — 사용자가 고른 해외 계정 감시 → 후보당 LLM 1회(제외 판단 + 한마디 ①②) → 텔레그램 카드. 발행은 카드 승인 후에만. 하루 최대 6장 · 대기 카드 8장 넘으면 쉼.
