---
name: project-pipeline-b-discovery
description: "Pipeline B(스하리·팔로워부스팅) 스하리 상대 발견은 \"스하리1000명프로젝트\" 등 스레드 해시태그 검색"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-01T06:34:00.947Z
---

Pipeline B (스하리·팔로워부스팅) 의 스하리 상대 발견은 **스레드 해시태그 검색** 으로 한다.

대표 해시태그:
- `스하리1000명프로젝트`
- (기타 유사 해시태그 발견 시 추가)

**Why**: 스하리 = 스레드 하리(팔로우백 요청) 문화가 있어서 스레드 사용자들이 자기가 스하리 참여 중임을 해시태그로 명시. 이 해시태그 게시글에 좋아요·댓글·팔로우 하면 상대도 팔로우백 확률 높음.

**How to apply**:
- Pipeline B 배선 시 발행 대신 검색 워커부터 만들기
- Apify Threads actor (themineworks) 의 Hashtag feed mode 활용 (이미 검증됨)
- 해시태그 검색 결과 → 계정 목록 → 하드 캡(하루 3~5) 지키며 팔로우백 액션
- CLAUDE.md 최소 규칙: 스하리 팔로우백 하루 3~5회 하드 캡, 초과 시 즉시 셧다운

관련: [[feedback-verify-before-done]]
