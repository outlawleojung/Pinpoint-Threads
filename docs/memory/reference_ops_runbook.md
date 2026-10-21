---
name: reference-ops-runbook
description: 운영 이어받기 전 docs/08-decisions/ops-runbook.md 필독 — 프로세스 3개(dev/dev:bot/dev:worker), 하루 흐름, URL 수동 처리(scripts/ops), 문구 원칙, 계정 상태
metadata:
  type: reference
---

운영 런북 = `docs/08-decisions/ops-runbook.md` (CLAUDE.md 세션 시작 0번). 수동 처리 스크립트는 `scripts/ops/` (urls-hold · frame-grid.sh · send-card · keep-sharing-asset · perf · followers · queue-status · reschedule-approved). 워커 재시작 전 reschedule-approved 필수(밀린 글 동시 발행 방지). 관련: [[project-sharing-daily-moment-style]], [[feedback-publish-via-telegram-card]]
