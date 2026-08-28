# Pinpoint-Threads Docs Index

프로젝트의 모든 설계·규칙·의사결정 문서 카탈로그. 어느 AI든 이 파일을 먼저 읽고 필요한 문서만 부분 로드하세요.

## 🔴 세션 시작 필수 (다른 것보다 먼저)

- [STATE](STATE.md) — 현재 프로젝트 상태 스냅샷 (Phase, 검증 완료, credential 상태)
- [TASKS](TASKS.md) — 21개 태스크 체크리스트 (완료·미완료·사용자 액션 대기)
- [session-log/](session-log/) 최신 파일 — 이전 세션 인수인계
- [ROADMAP](ROADMAP.md) — Priority 매트릭스 (덜 자주 갱신)

## 00-overview
- [vision](00-overview/vision.md) — 프로젝트 목적, 수익 모델, 성공 지표
- [glossary](00-overview/glossary.md) — 스하리, 쿠파스, CIB 등 용어 정의

## 01-pipelines
- [A-shopping](01-pipelines/A-shopping.md) — 쇼핑 콘텐츠 파이프라인 (커머스·수익화)
- [B-suhari](01-pipelines/B-suhari.md) — 스하리 파이프라인 (팔로워 부스팅)
- [C-daily](01-pipelines/C-daily.md) — 일상글 파이프라인 (엔게이지먼트)

## 02-architecture
- [tech-stack](02-architecture/tech-stack.md) — 확정 스택
- [state-machine](02-architecture/state-machine.md) — Post 상태 전이 규칙
- [data-flow](02-architecture/data-flow.md) — 파이프라인별 데이터 흐름도
- [folder-layout](02-architecture/folder-layout.md) — src 폴더 구조

## 03-infrastructure
- [local-dev](03-infrastructure/local-dev.md) — 로컬 부팅 가이드
- [database](03-infrastructure/database.md) — Neon Postgres + pgvector
- [deployment](03-infrastructure/deployment.md) — VPS 이전 계획
- [cost-model](03-infrastructure/cost-model.md) — 월 비용 예측
- [scaling-limits](03-infrastructure/scaling-limits.md) — 계정 수별 병목 및 대응 매트릭스

## 04-safety
- [account-isolation](04-safety/account-isolation.md) — 4개 계정 격리 규칙
- [cib-prevention](04-safety/cib-prevention.md) — Meta CIB 감지 회피
- [legal-compliance](04-safety/legal-compliance.md) — 공정위 문구·법적 규칙
- [rate-limits](04-safety/rate-limits.md) — 하드 캡·딜레이 정책

## 05-data-collection
- [strategy](05-data-collection/strategy.md) — 수집 대상별 방식 매트릭스
- [benchmark-schema](05-data-collection/benchmark-schema.md) — BenchmarkPost 스키마
- [rag-design](05-data-collection/rag-design.md) — 벡터 검색·Few-shot 설계
- [self-improvement](05-data-collection/self-improvement.md) — 발행 성과 회수 루프

## 06-accounts
- [personas](06-accounts/personas.md) — 4계정 페르소나 정의
- [schedules](06-accounts/schedules.md) — 계정별 활동 시간대
- [credentials](06-accounts/credentials.md) — 토큰 관리 (실제 값은 .env)

## 07-external-apis
- [threads](07-external-apis/threads.md) — Meta Threads Graph API
- [coupang](07-external-apis/coupang.md) — HMAC 서명·검색·딥링크
- [musinsa](07-external-apis/musinsa.md) — 큐레이터 API
- [telegram](07-external-apis/telegram.md) — grammY 봇·승인 UI
- [anthropic](07-external-apis/anthropic.md) — Claude 호출 정책

## 08-decisions (ADR)
- [001-static-copy-first](08-decisions/001-static-copy-first.md) — 정적 카피로 발행 시작
- [002-neon-cloud-db](08-decisions/002-neon-cloud-db.md) — 처음부터 Neon 클라우드 DB
- [003-twelve-module-catalog](08-decisions/003-twelve-module-catalog.md) — 12개 런타임 모듈로 축약
- [004-three-pipelines](08-decisions/004-three-pipelines.md) — 파이프라인 3개 (A/B/C)
- [005-rag-deferred](08-decisions/005-rag-deferred.md) — RAG는 데이터 임계량 후 자동 전환
- [006-doc-structure](08-decisions/006-doc-structure.md) — 인덱스 기반 분리 문서 구조
- [007-content-recycling](08-decisions/007-content-recycling.md) — 콘텐츠 재활용 전략 도입
- [008-n-scale-safe](08-decisions/008-n-scale-safe.md) — 무한 확장 대응 설계 원칙
- [pending-musinsa-strategy](08-decisions/pending-musinsa-strategy.md) — 무신사 큐레이터 활용 전략 (결정 대기)

## 09-agents (런타임 모듈)
- [catalog](09-agents/catalog.md) — 12개 모듈 총람
### shared/ (파이프라인 공용)
- [source-collector](09-agents/shared/source-collector.md)
- [content-classifier](09-agents/shared/content-classifier.md)
- [copywriter](09-agents/shared/copywriter.md)
- [media-handler](09-agents/shared/media-handler.md)
- [publisher](09-agents/shared/publisher.md)
- [approval-gate](09-agents/shared/approval-gate.md)
- [performance-collector](09-agents/shared/performance-collector.md)
- [planner-auditor](09-agents/shared/planner-auditor.md)
### pipeline-a/ (쇼핑 전용)
- [product-matcher](09-agents/pipeline-a/product-matcher.md)
- [vision-verifier](09-agents/pipeline-a/vision-verifier.md)
- [reply-composer](09-agents/pipeline-a/reply-composer.md)
### pipeline-b/ (스하리 전용)
- [engagement-worker](09-agents/pipeline-b/engagement-worker.md)
