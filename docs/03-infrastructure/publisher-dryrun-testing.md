---
title: "Publisher 안전 검증 전략 (dry-run + 실 발행)"
tags: ["publisher", "testing", "verification", "safety"]
related: ["threads", "publisher"]
last_updated: "2026-08-31"
status: "planned"
---

# Publisher 안전 검증 전략

Publisher 실 발행(#4c) 전 계정 리스크 최소화하며 검증하는 3단계 접근.

## 왜 필요한가

- 발행 후 즉시 삭제 반복 = Meta 봇 감지 패턴 → 계정 신뢰도 하락 · shadow ban 리스크
- 하지만 "코드는 있는데 한 번도 실 API 안 돌려본 상태" = 배포 시 예상치 못한 실패 위험
- **Container-only dry-run으로 90% 검증 → 최소 실 발행 1회로 나머지 검증**

## 3단계 검증 흐름

### 1단계: Container-only dry-run (리스크 0)

Threads API는 2-step:
```
POST /me/threads          → container ID 반환 (미게시)
POST /me/threads_publish  → 실 게시 (이 시점에 계정 타임라인 노출)
```

**1단계까지만 실행하면 아무데도 안 올라감.**

Publisher에 `dryRun: boolean` 옵션 추가:
- `dryRun: true` → createContainer + waitForContainerReady 까지만
- publishContainer 호출 skip
- 로그에 "dry-run 완료, container: xxx · 실 발행 안 함"
- Post 상태는 여전히 APPROVED 유지 (PUBLISHED 안 감)

**검증 가능 항목:**
- OAuth 토큰 유효성
- 요청 헤더 · 폼 인코딩
- 미디어 URL 접근 가능 여부 (Meta가 Cloudinary 이미지 fetch)
- Container status 폴링 (IN_PROGRESS → FINISHED)
- 캐러셀 (다중 이미지) 조립
- 텍스트 · reply_to_id 필드 처리
- rate limit 응답

**5계정 모두** 이 방식으로 검증 · 리스크 0.

### 2단계: 실 발행 1회 · 삭제하지 않고 방치

**가장 팔로워 적은 계정 하나** 선택.

- 짧은 자연스러운 게시글 발행 (예: "저 여기 있어요 👋")
- 안 지우고 방치 → 며칠 후 자연스럽게 밀림
- 부담되면 몇 주 후 앱에서 수동 삭제 (자연 사용 패턴)

**추가 검증 항목:**
- 실제 Threads 타임라인에 노출 확인
- 고정 댓글이 자기 답글로 정상 표시
- 링크 프리뷰 자동 억제 확인
- Cloudinary 이미지 Meta CDN에 mirror되는 시간

### 3단계: 스케줄러 실 가동

- Publisher 스케줄러(#4d) + Performance Collector(#4e) 전 계정 활성
- 정상 콘텐츠 (Pipeline A 승인 카드 → 승인)
- 첫 주는 하루 1건씩만 · 결과 관찰
- 이상 없으면 정상 운영

## Publisher dryRun 구현 노트 (다음 세션 착수 시)

**파일**: `src/modules/shared/publisher/index.ts`

**변경:**
```typescript
export interface PublishInput {
  postId: string;
  dryRun?: boolean; // 신규: true면 container 생성만, publish 안 함
}
```

**로직:**
```typescript
if (input.dryRun) {
  // container 생성 · status FINISHED까지 대기
  // publishContainer skip
  // Post 상태 유지 (APPROVED 그대로)
  // 결과에 dryRun: true 반영
  return { postId, threadsPostId: null, dryRun: true, containerId };
}
// 기존 실 발행 로직 그대로
```

**ThreadsClient.publish 도 dryRun 옵션 추가:**
- publishContainer 호출 skip
- containerId만 반환

**Admin UI:**
- Publisher 스케줄러 트리거에 "dry-run 모드" 체크박스
- 승인 게이트 콜백에도 dry-run 옵션 (테스트 시 편의)

**BullMQ job:**
- PublishJob type에 dryRun?: boolean 필드 추가
- 워커는 그대로 (job.data.dryRun 그대로 넘김)

**로그 · Telegram 알림:**
- "🧪 [dry-run] container xxx 생성 · 실 발행 안 함" 명시

## 관련 문서

- [Publisher 모듈](../09-agents/shared/publisher.md)
- [Threads API](../07-external-apis/threads.md)
