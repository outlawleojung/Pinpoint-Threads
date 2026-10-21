---
name: feedback_rules_enforced_not_requested
description: 카피 규칙은 프롬프트에 덧붙이는 것으로 안 지켜짐 → styleCheckCopy로 강제 · 새 규칙이 사용자 기존 규칙과 충돌하는지 먼저 확인
metadata:
  type: feedback
---

**사용자 규칙(장면 서술 금지·대놓고 묻기 금지·사족 금지·감성멘트 금지·원작자 정황 재연 금지)은 생성 후 `styleCheckCopy`(copywriter/index.ts)로 강제한다.** 위반이면 사유와 함께 재생성(일상 최대 2회, 쇼핑은 경고).

**Why:** 2026-09-30 사용자 "지금 그렇게 되어 있는 것들을 하나도 지키지 않고 있잖아" · "매번 설명을 해야 하는 거야? 이게 무슨 자동화야?". 원인 ① 내가 강의에서 가져와 덧붙인 규칙(밸런스게임·질문 1개·질문형 첫 줄 목록·"마지막은 참여 유도"·"구체적 장면+반응")이 사용자 규칙과 정면 충돌 → 생성기가 아무거나 따름 ② 규칙 준수 검사 단계가 없어 위반이 그대로 카드로 나감.

**How to apply:** 카피 규칙을 추가하기 전에 기존 사용자 규칙(메모리·dailyToneRules·winning-style)과 충돌하는지 먼저 확인. 사용자 규칙이 우선, 나중에 정해진 사용자 규칙이 이전 것보다 우선. 사용자 규칙을 "걷어내자"는 제안 금지(사용자가 쌓은 정정 자산). 검증은 스크립트가 아니라 텔레그램 실제 흐름으로. [[feedback_image_understand_not_describe]] [[feedback_verify_before_done]]
