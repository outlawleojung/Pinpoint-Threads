---
title: "Meta Threads Graph API"
tags: ["api", "threads", "meta"]
related: ["credentials", "publisher", "engagement-worker", "performance-collector"]
last_updated: "2026-08-31"
status: "active"
---

# Meta Threads Graph API

## 참조

- 공식 문서: https://developers.facebook.com/docs/threads
- 앱: Pinpoint Threads (App ID `1055715417182617`, Threads App ID `994801270245194`)
- 심사 상태: 개발 모드, 5 테스터 등록 완료. Public 승인 여부 확인 필요.

## 획득한 권한 (Development)

- `threads_basic` — 기본 조회
- `threads_content_publish` — 본문 발행
- `threads_manage_replies` — 댓글 관리
- `threads_manage_insights` — 성과 회수
- `threads_read_replies` — 댓글 조회
- `threads_keyword_search` — 해시태그 검색 (별도 앱 심사 필요할 수 있음)
- `threads_profile_discovery` — 프로필 조회 (제한적, 팔로워 100+ public + 화이트리스트)

## 지원되는 것 (우리 파이프라인 사용)

| 기능 | 엔드포인트 (근사) | 필요 권한 | 우리 활용 |
|---|---|---|---|
| 본문 발행 (2-step container) | `POST /me/threads` → `POST /me/threads_publish` | `threads_content_publish` | Publisher |
| 댓글 발행 (자기 게시글에 답글) | `POST /me/threads` with `reply_to_id` | `threads_manage_replies` | Publisher (고정 댓글) |
| 내 게시글 조회 | `GET /me/threads` | `threads_basic` | Performance Collector |
| 내 게시글 insights | `GET /{threads-media-id}/insights` | `threads_manage_insights` | Performance Collector |
| 게시글 댓글 조회 | `GET /{threads-media-id}/replies` | `threads_read_replies` | Comment Watcher (Pipeline B) |
| 프로필 aggregate | `GET /me/threads_insights?metric=followers_count` | `threads_manage_insights` | 대시보드 |

## ⚠️ 미지원 (2026-08-31 정밀 조사 확정)

**팔로우 관련 기능 전무:**

| 기능 | 상태 | 이유 |
|---|---|---|
| 자동 팔로우/언팔로우 실행 | ❌ 없음 | Write 엔드포인트 · `threads_manage_follows` 스코프 자체 미존재 |
| 팔로워 목록 조회 (`/me/followers`) | ❌ 없음 | Meta 미제공. 개발자 커뮤니티 요청 계류 중 |
| 팔로잉 목록 조회 (`/me/following`) | ❌ 없음 | 동일 |
| 특정 사용자의 나 팔로우 여부 검증 | ❌ 없음 | 필터 파라미터 · relationship-lookup 엔드포인트 없음 |

**댓글 작성자 정보 제한:**

- `/replies` 응답으로 얻는 필드: `id`, `text`, `timestamp`, `username`, `permalink`, `media_type`, `media_url`, `shortcode`, `has_replies`, `root_post`, `replied_to`, `is_reply`, `is_reply_owned_by_me`, `hide_status`, `reply_audience`
- **얻을 수 있음**: `username`
- **얻을 수 없음**: numeric user id, bio, 팔로워 수, 프로필 상세
- 프로필 상세는 `threads_profile_discovery` 필요 + 팔로워 100+ public 프로필 + 화이트리스트

## Rate Limits

- 사용자당 24h rolling **1,000 requests**
- `keyword_search` 등 별도 승인 권한은 더 낮을 수 있음

## 우리 시스템에 미치는 영향

### Publisher (Phase 4b) — 지원됨
- 2-step 본문 발행 + 고정 댓글 재현 가능
- 자동 링크 프리뷰 이슈는 실 발행 시 확인

### Performance Collector (Phase 4e) — 지원됨
- Insights API로 게시글 성과 회수 가능
- 24h/72h 후 좋아요·댓글·리포스트 카운트

### Engagement Worker (Pipeline B) — 부분 지원, 나머지 수동
- Comment Watcher (댓글 폴링): ✅ 지원
- Candidate Notifier (Telegram 알림): ✅ 지원
- **팔로우 실행 + 검증**: ❌ **미지원, 수동 처리**
- 상세: [engagement-worker](../09-agents/pipeline-b/engagement-worker.md)

## 향후 변화 대응

Meta가 팔로우 관련 엔드포인트 추가 시 Engagement Worker 재설계. 지금은 미지원 확정.

## 관련 문서

- [publisher](../09-agents/shared/publisher.md)
- [engagement-worker](../09-agents/pipeline-b/engagement-worker.md)
- [performance-collector](../09-agents/shared/performance-collector.md)
- [credentials](../06-accounts/credentials.md)
