---
title: "planner-auditor"
pipelines: ["A", "B", "C"]
ai_model: "none"
tags: ["agent", "runtime-module", "scheduling", "safety", "recycling"]
related: ["schedules", "rate-limits", "cib-prevention", "benchmark-schema"]
last_updated: "2026-08-28"
status: "draft"
---

# planner-auditor

일일 발행 계획 수립 + CIB 안전 모니터링.
결정론적 로직. AI 미사용.

## 목적

매일 아침 각 계정별로 그날의 발행 계획을 수립하고, 실행 중 CIB 감지 위험 신호를 모니터링.

## 두 개의 서브 컴포넌트

### 1) Daily Planner
- 매일 06:00에 실행 (계정 타임존별)
- 각 계정에 대해 오늘의 발행 슬롯 계산
- A/B/C 파이프라인 믹스 결정
- 신규 소스 vs 재활용 콘텐츠 비율 결정
- BullMQ에 delayed job 예약

### 2) Safety Auditor
- 실시간 이벤트 모니터링
- 위험 신호 감지 시 알림·자동 셧다운

## 발행 슬롯 규칙

계정당 하루 예시 스케줄:

```
07:30~08:30 (아침)   : 스하리 1건 (Pipeline B)
09:00~11:00 (오전)   : 쇼핑 1건 (Pipeline A) - 장보기 전 타겟
13:00~16:00 (낮)     : 일상글 1건 (Pipeline C)
19:00~22:00 (저녁)   : 쇼핑 1건 (Pipeline A)
21:00~23:00 (밤)     : 일상글 1건 (Pipeline C, 유동)
```

- 각 슬롯 내에서 계정별 랜덤 오프셋 (계정 간 시차 확보)
- 계정 활동 시간대 프로필 존중 ([schedules](../../06-accounts/schedules.md))

## 신규 vs 재활용 비율

```typescript
interface DailyMix {
  newSourceRatio: number;    // 0~1
  recycleRatio: number;      // 0~1 (sum = 1)
}

function decideMix(account: Account, benchmarkPoolSize: number): DailyMix {
  if (benchmarkPoolSize < 50) return { newSourceRatio: 1.0, recycleRatio: 0 };
  if (benchmarkPoolSize < 200) return { newSourceRatio: 0.7, recycleRatio: 0.3 };
  return { newSourceRatio: 0.5, recycleRatio: 0.5 };  // 안정기
}
```

- 벤치마크 풀 작을 땐 신규 위주
- 임계 넘으면 재활용 병행
- 성과 좋은 콘텐츠 최대한 우려먹기

## 재활용 배치 규칙

```typescript
function pickRecycleCandidate(
  accountId: string,
  pipeline: 'A' | 'B' | 'C',
  category?: string,
): BenchmarkPost | null {
  return db.benchmarkPost.findFirst({
    where: {
      isArchived: false,
      recycleEligibleAt: { lte: new Date() },
      pipelineFit: { path: [pipeline], gte: 0.5 },
      category: category ?? undefined,
      // 이 계정에서 최근 사용 안 함
      OR: [
        { NOT: { usedByAccounts: { has: accountId } } },
        // 또는 마지막 사용이 90일 이상 (evergreen이면 30일)
        { AND: [...] }
      ],
    },
    orderBy: { engagementScore: 'desc' },
    take: 1,
  });
}
```

## Safety Auditor 감지 신호

### 1. 동일 URL 반복 노출
- 같은 딥링크가 24h 이내 여러 계정에 발행 시도 → 차단
- 상품 중복 방지 (`(account_id, product_id)` 14일 유니크)

### 2. 시간대 몰림
- 다계정이 15분 이내 동시 발행 시도 → 지연 강제

### 3. 콘텐츠 유사도
- 최근 발행 게시글 본문 임베딩 코사인 유사도 > 0.85 → 재생성 요청

### 4. 스하리 하드 캡 근접
- 오늘 팔로우백 카운터가 상한 -1 도달 → 다음 실행 지터 확대

### 5. Rate Limit 접근
- Threads API 응답 헤더 X-App-Usage 모니터링
- 80% 도달 시 큐 속도 감속

### 6. 계정 정지 감지
- Publisher 실패 응답이 403·401 반복 → 해당 계정 즉시 격리·알림

## 알림 채널

- Telegram DM → 사용자님
- 심각도별 분류: INFO / WARN / CRITICAL

## N-Scale Safe

- 4계정에서도 200계정에서도 동일 로직으로 동작
- 계정 수는 config·DB에서만 결정, 코드에 하드코딩 금지
- 스케일 한계 시점 (예: 100계정 이상에서 슬롯 계산 부하) 도달 시 별도 튜닝

## 관련 문서

- [schedules](../../06-accounts/schedules.md) — 계정별 활동 시간대
- [rate-limits](../../04-safety/rate-limits.md) — 하드 캡 정책
- [cib-prevention](../../04-safety/cib-prevention.md) — CIB 감지 회피
- [benchmark-schema](../../05-data-collection/benchmark-schema.md) — 재활용 대상 데이터
