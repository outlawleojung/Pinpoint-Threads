# Pinpoint-Threads 실행 로드맵

브레인스토밍이 아니라 실제 실행 순서. 우선순위·의존성 명시.

## 원칙
- **외부 대기 시간 긴 것부터** (Meta 승인 최우선)
- **의존성 그래프** 존중 (뭐가 뭘 막는지)
- **사용자님 vs 저 역할 분리**
- 병렬 가능하면 병렬

## Priority 1 — 외부 의존성 해제 (사용자님, 오늘 안에 병렬)

| # | 작업 | 소요 | Task ID |
|---|---|---|---|
| 1a | Meta App 등록 & Threads API 신청 | 30분 | #1 |
| 1b | Neon Postgres 프로젝트 생성 & connection string | 10분 | #2 |
| 1c | Cloudflare R2 버킷 & Access Key | 15분 | #3 |
| 1d | Apify Threads Actor 무료 시험 | 15분 | #4 |
| 1e | 4개 Threads 계정 상태 점검 | 10분 | #5 |

## Priority 2 — 기반 인프라 이관 (제가, 1b 완료 후)

| # | 작업 | 소요 | Task ID | Blocks |
|---|---|---|---|---|
| 2a | 로컬 Postgres → Neon 이관 | 10분 | #6 | 1b |
| 2b | pgvector 활성화 & BenchmarkPost 마이그레이션 | 10분 | #7 | 2a |
| 2d | src 12-module 재구조화 | 30분 | #8 | 없음 |

## Priority 3 — 커머스 파이프라인 실 구현 (제가, Meta 대기 중 병행)

| # | 작업 | 소요 | Task ID | Blocks |
|---|---|---|---|---|
| 3a | Coupang HMAC + Search + Deeplink | 2h | #9 | 사용자 Access Key |
| 3b | Vision Verifier 실 테스트 | 30분 | #10 | 없음 |
| 3c | Content Classifier 실 테스트 | 30분 | #11 | 없음 |
| 3d | Copywriter 카피 튜닝 | 1h | #12 | 없음 |
| 3e | Product Matcher 통합 | 2h | #13 | 3a, 3b |
| 3f | Media Handler (R2) | 1h | #14 | 1c |
| 3g | Reply Composer 4양식 다변화 | 30분 | #15 | 없음 |
| 3h | Pipeline A e2e 검증 | 1h | #16 | 3a~3g |

## Priority 4 — 발행 파이프라인 (Meta 승인 후)

| # | 작업 | 소요 | Task ID | Blocks |
|---|---|---|---|---|
| 4a | Threads Graph API OAuth 흐름 | 2h | #17 | 1a |
| 4b | Publisher (2-step + 고정 댓글) | 2h | #18 | 4a |
| 4c | 실 계정 1개 발행 e2e | 30분 | #19 | 3h, 4b |
| 4d | 4계정 스케줄링 | 2h | #20 | 4c |
| 4e | Performance Collector | 1h | #21 | 4c |

## Priority 5+ (나중에)

- Pipeline B (스하리) 상세 & Engagement Worker
- Pipeline C (일상글) 상세 & Cultural Adapter
- Voyage AI 통합 & RAG 자동 전환
- 웹 대시보드 (N ≥ 20 접근 시)
- 주거용 프록시 (N ≥ 50)
- 계정 팜 프로세스 (N ≥ 100)

## 총 예상 소요

- 사용자님 오늘: **80분** (병렬 시 40분)
- 제가 Meta 대기 중: **약 8~9시간** (분산 진행)
- Meta 도착 후 발행 e2e까지: **약 8~9시간**
- **총 발행 시작까지: 최소 3~14일 (Meta 승인 대기가 결정적)**
