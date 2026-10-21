---
name: project_reply_link_repeat
description: 고정댓글 딥링크는 여러 번 반복해야 함 · 1개로 줄이지 말 것 + 프리뷰는 이미지 첨부로 억제
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-16T13:07:53.856Z
---

쇼핑 고정댓글의 딥링크는 **여러 번 반복**해서 넣는다 (`REPLY_LINK_REPEAT=3`, copywriter/index.ts). Threads가 고정댓글 링크를 하나 먹어버려(오류) 터진 글에서 링크가 통째로 사라지는 사고가 있어, 같은 링크를 여러 번 박아 하나라도 살아남게 하는 중복 방어. 사용자 원본 템플릿(양식 3·4=링크 2회)에서 유래, 구루 영상 근거로 3회.

**Why:** 링크가 사라지면 터진 글도 수익 0. 사용자가 원래 2개+ 템플릿을 줬는데 내가 재설계하며 1개로 줄여 이 방어가 사라졌었다("네가 계속 하나만 달았던 거야").

**How to apply:** 고정댓글 조립 시 링크를 1개로 축소하지 말 것. 링크 프리뷰(OG카드)는 ZWS 마스킹(효과 없음·클릭 깨짐)이 아니라 **답글에 Cloudinary 미디어 프레임 첨부**(publisher `deriveReplyImage`)로 억제 → URL은 깨끗하게 넣어 클릭 보장. [[feedback_fix_from_source_not_patch]]
