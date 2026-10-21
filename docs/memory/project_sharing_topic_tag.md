---
name: project_sharing_topic_tag
description: 스하리 태그는 본문 텍스트가 아니라 Threads topic_tag 파라미터로만 부착
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-08T08:57:49.078Z
---

스하리글의 "스하리1000명프로젝트" 태그는 **본문 텍스트에 `#`로 넣지 않는다.** 본문에 `#태그`를 타이핑하면 해시태그이면서 동시에 본문 글자로도 남기 때문. 대신 Threads Graph API의 `topic_tag` 파라미터(# 없이, ≤50자, 마침표·& 금지, 글당 1개, 전 미디어 타입)로 발행 시 부착 → 본문엔 안 보이고 태그로만 붙음.

**How to apply:** copywriter는 본문에서 문구를 완전히 제거(SHARING_TOPIC_TAG export), publisher가 `post.kind === 'SHARING'`일 때 `client.publish({ topicTag })`로 넘김. topic_tag는 최종(발행되는) 컨테이너에만 — 캐러셀 자식엔 X. 관련 [[feedback_no_narrow_interpretation]].
