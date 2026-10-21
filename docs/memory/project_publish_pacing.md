---
name: project_publish_pacing
description: 발행 페이싱 - 일상 계정당 하루 2건·스하리 1건·쇼핑 전체 1건 + 같은 계정 ≥4h + 계정 간 30분~1h 랜덤 시차(10/1~) · 승인해도 즉시발행 X
metadata:
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-22T05:49:04.345Z
---

**왜 이렇게 보수적인가:** 아직 계정 규모(팔로워)가 작아서. **팔로워 1천·1만 넘어가면 페이싱을 더 풀 예정**(하루 건수↑ 등) — 규모 커지면 이 규칙부터 재검토. 지금은 티어별 로직 미리 안 만듦(YAGNI·비용). [[feedback_conserve_api_cost]].

**발행 페이싱 규칙 (2026-09-18, 2026-09-22 도달우선 개정):**
- **쇼핑(SHOPPING) = 전체 계정 합산 하루 1건** (2026-09-22). 도달(조회수)이 너무 낮아 유입 측정 자체가 무의미 → 상업글 최소화, 도달 우선. 계정 무관 글로벌 캡.
- **일상(DAILY) = 계정당 하루 2건 (2026-09-30 사용자 "일상글을 많이 발행해야" · DAILY_PER_ACCOUNT_CAP).** 스하리(SHARING) = 계정당 하루 1건. 일상은 오히려 **더 늘려서**(여러 계정·자주) 도달 baseline 키우기 = [[project_reach_health_gate]] 도달엔진.
- **같은 계정 글끼리 최소 4시간 간격.**
- **★ 계정 간 시차 30분 + 랜덤 0~30분 (2026-10-01 · 사용자 "1~2h는 너무 오래 걸림 → 30분~1h" · `scheduler.ts` CROSS_ACCOUNT_*)** — 이전엔 스케줄러가 같은 계정만 봐서 스하리 5건이 1분 안에 동시 발행됨(pikkseetem 8뷰 등 도달 급락). CLAUDE.md의 "1~4h"보다 짧지만 사용자 결정이 우선.
- **벤치마크 URL 을 연달아 올려도 바로 발행 X.** 카드는 쌓아도 되고, 승인 시 다음 유효 시각으로 줄 세워 나감. 쇼핑은 하루 하나씩 다음날로 밀림.

**How it works (구현):** 텔레그램 수동 승인은 원래 즉시 발행이었는데([[project_correction_learning_loop]] 흐름), `approval-gate/service.ts` 승인 분기에서 `computeManualPublishSchedule(accountId, kind)`(`publisher/scheduler.ts`)로 지연 계산 → `publishQueue.add(delay)`. 규칙: (1) 마지막 발행/예약(APPROVED·PUBLISHING 포함) +4h, (2) 같은 종류가 이미 차지한 '날'은 다음날 활성시작으로 밀기. 승인 카드 응답에 예약 시각 표기("SHOPPING 다른 날 예약 → 9/19 08:19"). PENDING_APPROVAL 카드는 슬롯 미점유(승인해야 카운트).

**주의:** 자동 크론(shopping-publisher)은 별도 `scheduleApprovedPost` 사용(현재 자동발행 크론은 [[project_auto_llm_crons_disabled]]로 정지). 이 페이싱은 수동 승인 경로용.

**2026-10-13:** 시간창 — 스하리 08:00~10:30(10/15 확대: 3계정+30분~1h 시차가 90분 창에 안 들어가 sookck 다음 날로 밀림) · 일상/쇼핑 13:00~22:30 (scheduler.ts KIND_WINDOW). 6~7시로 옮긴 건 오해였음 → 원복.
