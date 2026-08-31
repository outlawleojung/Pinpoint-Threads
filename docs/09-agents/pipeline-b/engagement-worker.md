---
title: "engagement-worker"
pipelines: ["B"]
ai_model: "none"
tags: ["agent", "runtime-module", "suhari", "manual-action"]
related: ["B-suhari", "rate-limits", "cib-prevention", "threads"]
last_updated: "2026-08-31"
status: "revised"
---

# engagement-worker

Pipeline B의 발행 후 감시 & 팔로우백 후보 추천 모듈.
**팔로우 액션 자체는 수행하지 않음** (사용자 수동, 하루 3~5명).

## 재설계 배경 (2026-08-31)

Threads Graph API 정밀 조사 결과:
- 자동 팔로우/언팔로우 엔드포인트 없음
- 팔로워/팔로잉 목록 조회 API 없음
- 특정 사용자 팔로우 여부 검증 API 없음
- 댓글 작성자 정보는 `username`만 제공 (프로필 상세 불가)

따라서 초기 설계(Comment Watcher → Follow Verifier → Reciprocation Executor 3단 자동)는 **폐기**하고, "**후보 추천 + 수동 실행**" 모델로 재설계.

## 목적

내 스하리 게시글에 달린 댓글 작성자를 수집하여 사용자에게 팔로우백 후보로 알림.
팔로우 액션은 사용자가 Threads 앱에서 직접 수행.

## 세 개의 서브 컴포넌트

### 1) Comment Watcher (자동)

- 30분 간격 폴링 (cron)
- 오늘 스하리 게시글(state=PUBLISHED, pipeline=B)의 댓글을 `/{threads-media-id}/replies` 로 조회
- 응답에서 얻을 수 있는 것:
  - 댓글 텍스트, timestamp, permalink
  - 작성자 `username` (numeric id, bio, 팔로워 수는 미제공)
- 새 댓글이면 DB에 `EngagementCandidate` 레코드 생성

### 2) Candidate Notifier (자동)

- 오늘 새 후보들을 모아 Telegram 요약 알림
- 예: "오늘 스하리 게시글에 3명이 스하리 댓글 남김: @user_a, @user_b, @user_c"
- 각 후보별로 permalink 링크 첨부 → 앱에서 바로 열기 가능
- 오늘 남은 팔로우백 슬롯 카운트다운 표시 (3~5)

### 3) Manual Action Recorder (반자동)

- 사용자가 Threads 앱에서 팔로우 여부 확인 후 팔로우백 실행
- 텔레그램에서 **"완료" 버튼** 클릭 → DB에 EngagementLog 기록 + 카운터 +1
- 하루 상한 도달 시 다음 카운트다운 = 0, 다음날 리셋

## 하드 룰 (계정 안전)

- **자동 팔로우 절대 금지** — 공식 API 미지원, 비공식 API/브라우저 자동화 금지
- **하루 상한 3~5회** — 매일 아침 랜덤 결정. 초과 시 시스템이 더 이상 후보 추천 안 함.
- **자체 4~5개 계정끼리 절대 금지** — 후보 필터에서 우리 계정 자동 제외
- **팔로우 검증도 사람 눈으로** — API가 없으므로 사용자가 앱에서 확인

## 입력 (Job payload)

Comment Watcher가 새 댓글 감지 시:

```typescript
interface CandidateJob {
  accountId: string;           // 우리 발행 계정
  suhariPostId: string;        // 오늘 스하리 게시글
  commenterUsername: string;   // 댓글 작성자 (username만)
  commentText: string;
  permalink: string;           // 앱에서 바로 열 링크
  detectedAt: string;          // ISO datetime
}
```

## 출력

- `EngagementCandidate` 레코드 (아직 실행 안 함)
- Telegram 알림
- 사용자 "완료" 콜백 시 `EngagementLog` 레코드 (action=FOLLOW_MANUAL)

## 실패 모드 & 폴백

- Threads API rate limit (사용자당 24h rolling 1,000): 폴링 주기 조절
- 3회 연속 API 실패: Telegram 알림 후 다음 폴링 주기 대기
- 자체 계정 감지: 후보 목록에서 자동 제외 (에러 아님)

## 관찰 지표

- 계정별 일일 스하리 댓글 수
- 팔로우백 실행 완료율 (후보 대비 실행 비율)
- 카운터 소진 이력

## 관련 문서

- [B-suhari](../../01-pipelines/B-suhari.md) — 파이프라인 전체 흐름 (§ 9.3 결정 근거)
- [rate-limits](../../04-safety/rate-limits.md) — 하드 캡 정책
- [cib-prevention](../../04-safety/cib-prevention.md) — CIB 감지 회피
- [threads](../../07-external-apis/threads.md) — API 스펙 및 미지원 목록
