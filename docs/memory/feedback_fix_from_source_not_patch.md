---
name: feedback_fix_from_source_not_patch
description: 카피 수정 요청 시 한 단어 때우지 말고 원본 소스 찾아 전체 맥락으로 재생성
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-09T05:54:54.607Z
---

카피(일상글·쇼핑 등)에 오류를 지적하며 수정 요청하면, **틀린 단어 하나만 string replace로 때우지 마라.** 원본 소스(InboundLink.rawText 캡션, 원본 URL, 미디어)를 찾아 전체 맥락을 보고 **제대로 재생성**하라.

**Why:** 사용자는 "전체 상황 보고 원본 문장 보고 제대로 하라"고 명시. 한 단어 패치는 나머지 문장이 원본과 안 맞는 걸 방치함.

**How to apply:** 일상글(DAILY)은 sourceItem이 비어있을 수 있음 → 원본 캡션은 `InboundLink`(source=MANUAL_TELEGRAM, receivedAt desc)에 있음. 거기서 원문(예: 일본어 캡션) 확인 → 뜻 + 사용자 정정 반영해 `generateDailyBody`로 2~3개 재생성 → 재전송. 사용자 정정이 원문과 충돌하면(前の人 vs 옆사람) 사용자(영상 직접 봄)가 우선. 관련 [[project_pipeline_triggers]] [[feedback_naver_engaging_not_dry]].
