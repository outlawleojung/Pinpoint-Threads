---
title: "src 폴더 구조"
tags: ["architecture", "folder-layout", "12-modules"]
related: ["tech-stack", "catalog"]
last_updated: "2026-08-28"
status: "active"
---

# src 폴더 구조

12-module 카탈로그를 그대로 반영. 각 폴더 = 하나의 런타임 모듈 or 인프라 어댑터.

## 구조

```
src/
├── config/                    # 환경변수·로거
│   ├── env.ts
│   └── logger.ts
├── db/                        # Prisma 클라이언트
│   └── prisma.ts
├── infra/                     # 외부 시스템 클라이언트 (인프라 어댑터)
│   ├── anthropic-client.ts    # Claude Sonnet/Haiku
│   ├── cloudinary-client.ts   # 미디어 호스팅
│   ├── threads-client.ts      # Threads Graph API (Meta 승인 후)
│   └── commerce/              # 커머스 채널 어댑터
│       ├── types.ts
│       ├── coupang-client.ts
│       ├── musinsa-client.ts
│       └── router.ts          # 카테고리 → 채널 라우팅
├── modules/                   # 12개 런타임 모듈
│   ├── shared/                # 파이프라인 공용 8개
│   │   ├── source-collector/  # SourceAdapter 인터페이스 + Manual/Apify/Playwright 구현
│   │   ├── content-classifier/# AI 필터·분류·키워드 추출 (Haiku)
│   │   ├── copywriter/        # 본문 생성 (Sonnet, RAG 확장 지점)
│   │   ├── media-handler/     # Cloudinary 업로드 + 2개 이상 검증
│   │   ├── publisher/         # Threads 2-step 발행
│   │   ├── approval-gate/     # Telegram 승인 UI
│   │   │   ├── bot.ts         # grammY 봇 핸들러
│   │   │   ├── keyboards.ts   # 인라인 키보드
│   │   │   ├── service.ts     # 승인/콜백 상태 전이
│   │   │   └── index.ts
│   │   ├── performance-collector/ # 24h/72h insights 회수
│   │   └── planner-auditor/   # 일일 계획 + CIB 안전 모니터링
│   ├── pipeline-a/            # 쇼핑 전용 3개
│   │   ├── product-matcher/   # 채널 라우팅 + Vision 재검증
│   │   ├── vision-verifier/   # 원본↔상품 정합성 (Sonnet Vision)
│   │   └── reply-composer/    # 4양식 다변화 (고정 댓글)
│   └── pipeline-b/            # 스하리 전용 1개
│       └── engagement-worker/ # 팔로우백 (하루 3~5, 지터)
├── pipeline/
│   └── workers.ts             # BullMQ Worker 스켈레톤
├── queues/
│   ├── connection.ts          # ioredis 연결
│   └── queues.ts              # 큐 정의
├── state/
│   └── post-state-machine.ts  # Post 상태 전이 규칙
├── bot.ts                     # Entry: Telegram 봇 프로세스
├── index.ts                   # Entry: Fastify API 서버
└── worker.ts                  # Entry: BullMQ 워커 프로세스
```

## 원칙

### 1. infra/ 는 외부 시스템 어댑터
- 순수 클라이언트만 (비즈니스 로직 없음)
- 필요 시 다른 SDK로 갈아끼울 수 있게 (예: Cloudinary → R2)
- infra/ 파일은 modules/를 import 하지 않음 (역방향 의존 금지)

### 2. modules/ 는 12 런타임 모듈
- 각 폴더 = docs/09-agents/ 카탈로그의 한 모듈에 1:1 매핑
- 폴더 안에 `index.ts` (barrel export) + 내부 파일들
- 모듈끼리 의존은 다른 모듈의 `index.ts` 를 통해서만
- infra/ 는 자유롭게 import

### 3. 파이프라인별 격리
- pipeline-a/ 모듈들은 A만 사용
- pipeline-b/ 모듈들은 B만
- pipeline-c/ 는 shared/만 조합해서 사용 (전용 모듈 없음)

### 4. 12개 → 필요 시 확장
- 초기 12개 확정 (ADR 003)
- 특정 모듈이 부풀면 그때 세분화 (예: content-classifier가 커지면 filter/keyword-extractor로 분리)

## 관련 문서

- [ADR 003 (12-module catalog)](../08-decisions/003-twelve-module-catalog.md)
- [catalog](../09-agents/catalog.md)
- [tech-stack](tech-stack.md)
