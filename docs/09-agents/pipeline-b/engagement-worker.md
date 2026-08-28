---
title: "engagement-worker"
pipelines: ["B"]
ai_model: "none"
tags: ["agent", "runtime-module", "suhari", "rate-limit-critical"]
related: ["B-suhari", "rate-limits", "cib-prevention", "threads"]
last_updated: "2026-08-28"
status: "draft"
---

# engagement-worker

Pipeline B의 발행 후 감시 & 팔로우백 실행 모듈.
결정론적 로직. AI 미사용.
**계정 정지 리스크 가장 큰 모듈** — 하드 캡·랜덤 지터 필수.

## 목적

내 스하리 게시글에 달린 댓글을 폴링하고, 실제 팔로우한 사용자에 한해 팔로우백 실행. 하루 3~5회 상한 엄수.

## 세 개의 서브 컴포넌트

### 1) Comment Watcher
- 30분 간격 폴링 (cron)
- 오늘 스하리 게시글(state=PUBLISHED, pipeline=B)의 댓글 조회
- 새 댓글 감지 시 Job 큐에 투입

### 2) Follow Verifier
- Threads Graph API로 해당 사용자의 팔로우 관계 조회
- 나를 팔로우한 상태여야만 다음 단계 진행
- 안 되어 있으면 무시 (일방적 팔로우백 금지)

### 3) Reciprocation Executor
- 오늘 그 계정의 팔로우백 카운터 확인
- 카운터가 오늘 상한 이하이면 팔로우백 실행
- 랜덤 10~30분 지터 후 실행
- 카운터 +1

## 하드 룰 (계정 정지 방지)

- **하루 상한: 3~5회 (매일 아침 랜덤 결정)** — 예측 가능한 고정 숫자 금지
- **초과 시 즉시 셧다운** — 그날 나머지 댓글 모두 무시 (에러 아님, 정상 종료)
- **랜덤 지터 10~30분** — 감지 즉시 실행 금지
- **팔로우 검증 필수** — 상대가 팔로우 안 했으면 팔로우백 안 함
- **자체 4개 계정끼리 절대 금지** — 상대 handle이 우리 계정 중 하나면 즉시 스킵
- **팔로우백만 실행** — 하트·리포스트·답글 안 함

## 입력 (Job payload)

```typescript
interface ReciprocationJob {
  accountId: string;         // 우리 발행 계정
  suhariPostId: string;      // 오늘 스하리 게시글
  commenterHandle: string;   // 댓글 남긴 사용자
  commenterThreadsUserId: string;
  commentText: string;       // 참고용 로그
  detectedAt: string;        // ISO datetime
}
```

## 출력

DB `EngagementLog` 레코드 생성 (action=FOLLOW).
`DailyPostCount.engagementCount` +1.

## 실패 모드 & 폴백

- 팔로우 API 호출 실패 → 재시도 최대 2회 (backoff 5분)
- 3회 연속 실패 → 그날 그 계정의 워커 셧다운 + Telegram 알림
- Threads API rate limit 도달 → 다음 폴링 주기까지 대기
- 자체 계정 감지 → 즉시 스킵 (에러 아님)

## 관찰 지표

- 계정별 일일 팔로우백 실행 수
- 팔로우 검증 실패율 (스팸 댓글 비율 지표)
- 셧다운 발생 이력 (rate limit 위험 신호)
- Meta API 응답 시간·에러율

## 미결 (Open Questions)

### 팔로우백 실행 방법
Threads Graph API가 팔로우 관련 write 엔드포인트를 제공하는지 미확인.
- `POST /me/follows/{user_id}` 같은 엔드포인트 존재 여부
- 없다면 Playwright로 발행 계정 로그인 후 UI 자동화 (리스크 큼)
- `threads-api-expert` 서브에이전트로 확정 예정

### 폴링 주기 최적화
30분 간격이 적정한지, 아니면 이벤트 기반 웹훅이 가능한지.
- Threads Graph API의 comment webhook 지원 여부 확인 필요

## 관련 문서

- [B-suhari](../../01-pipelines/B-suhari.md) — 파이프라인 전체 흐름
- [rate-limits](../../04-safety/rate-limits.md) — 하드 캡 정책
- [cib-prevention](../../04-safety/cib-prevention.md) — CIB 감지 회피
- [threads](../../07-external-apis/threads.md) — API 스펙
