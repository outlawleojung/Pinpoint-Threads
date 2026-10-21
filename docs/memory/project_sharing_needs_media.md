---
name: project-sharing-needs-media
description: 스하리 글은 첨부 사진/영상 있는 것만 발행 · 첨부 없는 초안은 보류하고 사용자가 소재 찾아올 때까지 대기 (2026-10-02)
metadata:
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-10-02T01:09:11.752Z
---

스하리 글은 첨부(사진·영상)가 있는 것만 카드 발송/발행한다. 첨부 없는 초안은 만들어 두되 보류하고, 사용자가 첨부 소재를 찾아오면 그때 붙여서 발송.

**Why:** 2026-10-02 사용자 지시 ("첨부 사진이나 영상 없는 것들은 발행 하지 말고 기다려, 내가 찾아올께"). 10/1 글만 스하리 5건 중 3건이 12~29뷰로 저조.

**첨부 = 어그로용(10/3 사용자):** 스하리 첨부 사진·영상은 시선 끌기용이라 글 내용과 무관해도 됨 → 글에서 첨부를 설명·연결하지 말 것("얘가 대신 인사함" X). 재탕 시 첨부 교체 OK, 팔로워 숫자는 현재값으로 보정(sharing-repost.ts).

**How to apply:** 스하리 작성 시 첨부 보관분(Cloudinary `pinpoint-threads/sharing-assets/`)과 짝지어 제안. 첨부 없는 계정 초안은 session-log에 보류로 기록. 파이프라인 기본값(mediaUrls: [])으로 바로 카드 보내지 말 것. 관련: [[project-sharing-diversity]], [[project-pipeline-b-discovery]]

**2026-10-21 변경:** 사용자 "사진 없어도 스하리는 나간다 · 있으면 이목 더 끌어 좋음". 첨부는 선택 — 보관함 비면 텍스트로 생성·발행(orchestrator). 위 "첨부 필수"는 폐기.
