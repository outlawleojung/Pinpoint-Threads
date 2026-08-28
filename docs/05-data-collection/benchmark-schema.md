---
title: "BenchmarkPost 스키마"
tags: ["data-collection", "schema", "pgvector", "content-recycling"]
related: ["rag-design", "database", "planner-auditor", "self-improvement"]
last_updated: "2026-08-28"
status: "draft"
---

# BenchmarkPost 스키마

## 목적

두 가지를 동시에 담는 모델:
1. **RAG few-shot 소스** — 유사도 검색용 임베딩 저장
2. **재활용 콘텐츠 풀** — 히트한 콘텐츠를 다른 계정·다른 시점에 재사용

## 정의

```prisma
enum BenchmarkOrigin {
  MANUAL_SEED         // 사용자가 직접 시드로 넣은 것
  EXTERNAL_SCRAPED    // Apify/Playwright로 외부에서 수집한 것
  OWN_PUBLISHED       // 우리가 발행한 것 (성과 회수해서 승격된 것)
}

model BenchmarkPost {
  id                  String            @id @default(cuid())
  origin              BenchmarkOrigin

  // 원본 식별
  sourceUrl           String?           // 외부 원본 URL (있는 경우)
  contentHash         String            @unique  // 텍스트·이미지 dedup 키
  authorHandle        String?
  language            String?

  // 콘텐츠 본체
  rawText             String            @db.Text
  mediaUrls           String[]

  // 파이프라인 매핑
  category            String?           // 의류·뷰티·생활용품 등
  pipelineFit         Json              // {"A": 0.9, "B": 0.1, "C": 0.5} - 어느 파이프라인에 적합한 지 점수

  // 성과 지표
  engagementScore     Float             // 종합 점수 (likes·comments·reposts·author_followers 보정)
  lastReactionSnapshot Json             // {"likes": 342, "comments": 87, "reposts": 15, "capturedAt": "..."}
  reactionHistory     Json[]            // 시계열 스냅샷 (한 게시글의 반응 변화 추적)

  // 재활용 관리
  usedByAccounts      String[]          // 어느 계정에서 이미 사용했는지
  usedAt              DateTime[]        // 각 사용 시점 (usedByAccounts와 인덱스 매핑)
  recycleEligibleAt   DateTime?         // 다음 재활용 가능 시점 (null = 아직 사용 안 함)
  isEvergreen         Boolean           @default(false)  // 계속 재활용 가능한 콘텐츠 (계절·시의성 없음)
  recycleCount        Int               @default(0)      // 재활용 횟수
  maxRecycles         Int               @default(5)      // 상한 (초과 시 archive)

  // RAG 임베딩
  embedding           Unsupported("vector(1024)")  // Voyage AI multimodal 임베딩

  // 상태
  isArchived          Boolean           @default(false)  // 더 이상 재활용 안 함

  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt

  @@index([category, engagementScore(sort: Desc)])
  @@index([recycleEligibleAt])
  @@index([origin, isArchived])
}
```

## 성과 점수 계산

```typescript
function calcEngagementScore(post: {
  likes: number;
  comments: number;
  reposts: number;
  authorFollowers?: number;
}): number {
  // 팔로워 파워 보정 (팔로워 많으면 인위적 반응 아님)
  const followerBase = Math.max(post.authorFollowers ?? 500, 500);
  const rawScore = post.likes + 3 * post.comments + 2 * post.reposts;
  return rawScore / followerBase;
}
```

- 댓글 가중치 높음 (진짜 참여 지표)
- 리포스트 중간 (확산 지표)
- 좋아요 낮음 (가장 흔한 반응)
- 팔로워 수로 나눠서 "팔로워 파워" 필터

## 재활용 규칙

### 재활용 가능 조건 (Planner가 매일 체크)

```typescript
function isRecycleEligible(post: BenchmarkPost, targetAccountId: string): boolean {
  if (post.isArchived) return false;
  if (post.recycleCount >= post.maxRecycles) return false;
  if (post.recycleEligibleAt && post.recycleEligibleAt > new Date()) return false;

  const alreadyUsedByAccount = post.usedByAccounts.includes(targetAccountId);
  if (alreadyUsedByAccount) {
    // 같은 계정에서 다시 쓰려면 90일 이상 지나야 함 (isEvergreen이면 30일)
    const lastUseIdx = post.usedByAccounts.lastIndexOf(targetAccountId);
    const lastUse = post.usedAt[lastUseIdx];
    const minInterval = post.isEvergreen ? 30 : 90;
    const daysSince = (Date.now() - lastUse.getTime()) / 86400000;
    if (daysSince < minInterval) return false;
  }

  return true;
}
```

### 재활용 시점 결정 (recycleEligibleAt)

성과가 확정된 후에만 재활용 대상 등록:
- 발행 후 72시간 뒤 성과 회수 → engagementScore 계산 → threshold 넘으면 recycleEligibleAt = now + 14일
- 초기 대기 14일: 원본이 아직 살아있는 동안 다른 계정에 유사 콘텐츠 발행하면 감지 위험

### Evergreen 판정

3회 이상 재활용에도 계속 성과 좋은 콘텐츠 → `isEvergreen = true` 자동 전환.
Evergreen은 재활용 상한(maxRecycles) 없음, 30일 간격만 유지.

## 승격 규칙 (OWN_PUBLISHED → BenchmarkPost)

우리가 발행한 게시글이 성과 좋으면 자동으로 벤치마크에 편입:

```typescript
function shouldPromote(post: PublishedPost): boolean {
  if (post.pipeline !== 'A' && post.pipeline !== 'C') return false;  // 스하리 제외
  const score = calcEngagementScore(post.reactions);
  return score >= 0.15;  // 임계값 (실측 후 튜닝)
}
```

## RAG 검색 시 사용

Copywriter가 새 카피 생성 시:
1. 새 소스 텍스트+이미지를 Voyage로 임베딩
2. `BenchmarkPost` 중 `origin != 'MANUAL_SEED' or origin='OWN_PUBLISHED'` 필터
3. cosine similarity + engagementScore 가중 → top-K 5개
4. Few-shot 프롬프트에 주입

## 관련 문서

- [rag-design](rag-design.md) — 벡터 검색 상세
- [self-improvement](self-improvement.md) — 발행 성과 회수 → BenchmarkPost 승격
- [planner-auditor](../09-agents/shared/planner-auditor.md) — 재활용 배치 규칙
- [strategy](strategy.md) — 수집 방식
