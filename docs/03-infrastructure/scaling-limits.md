---
title: "스케일 한계 지점"
tags: ["infrastructure", "scalability", "scaling", "cost"]
related: ["cost-model", "deployment", "database"]
last_updated: "2026-08-28"
status: "draft"
---

# 스케일 한계 지점 (Scaling Limits)

각 컴포넌트가 계정 수 N에 따라 언제 병목이 되고, 어떻게 대응하는지의 매핑.
[ADR 008 N-Scale Safe](../08-decisions/008-n-scale-safe.md) 실행 가이드.

## 컴포넌트별 스케일 매트릭스

| 컴포넌트 | N ≤ 5 | N ≤ 20 | N ≤ 100 | N > 100 |
|---|---|---|---|---|
| **Postgres/Neon** | Free tier (500MB) | Pro $19 | Pro $19 (~10GB) | Scale-plus $100+ |
| **Redis** | 로컬 Docker | VPS Docker | Managed Redis $15+ | Redis 클러스터 |
| **Compute (Node)** | 1 VPS $6 | 1 VPS $12~24 | 2~3 VPS 로드밸런싱 $50+ | K8s or 매니지드 |
| **IP 분리** | 1 IP OK | 2~3 IP $30 | 주거용 프록시 필수 $200+ | 프록시 팜 $500+ |
| **승인 UI** | Telegram | Telegram | **웹 대시보드 필수** | 다인 대시보드 + 권한 |
| **계정 팜** | 수동 | 반자동 | 자동화 시스템 | 팀 운영 |
| **인력** | 혼자 | 혼자 | 파트타임 1~2인 | 팀 3~5인 |
| **Anthropic 월 비용** | $20 | $80 | $500~1000 | $2000~5000 |
| **Apify 월 비용** | $5 | $20 | $80~150 | $300+ |
| **월 총 인프라** | $30~50 | $80~200 | $500~1500 | $2000~5000+ |

## 컴포넌트별 첫 병목 시점

### N = 5 → 20 전환에서 첫 병목
- **Anthropic 토큰 폭발** — 무제한 재생성 요청이면 예산 초과
  - 대응: 재생성 상한 설정 (계정별 하루 X회)
- **Redis 로컬 Docker 안정성** — VPS Docker로 이동

### N = 20 → 50 전환에서 첫 병목
- **Telegram 승인 UI 부하** — 하루 100건 승인 화면 스크롤 불편
  - 대응: 웹 대시보드 도입 (Fastify + 간단한 React/HTMX)
- **IP 다양성 부족** — Meta CIB 감지 위험 상승
  - 대응: 주거용 프록시 도입 (Bright Data, Smartproxy 등)

### N = 50 → 100 전환에서 첫 병목
- **계정 팜 병목** — 신규 계정 확보·워밍업 속도가 확장 속도 못 따라감
  - 대응: 계정 팜 파이프라인 별도 모듈 (Pipeline D 검토)
  - 또는: 계정 판매·조달 시장 활용
- **파트타임 인력 필요** — 하루 400건 승인은 혼자 감당 불가

### N = 100 → 500 전환에서 첫 병목
- **팀 운영 필요** — 3~5인
- **인프라 대규모 개편** — K8s or 매니지드 서비스
- **사업자 등록·회계 프로세스** — 매출 규모상 필수

## 하드 상한 (기술적 한계)

| 항목 | 상한 |
|---|---|
| Meta App 하나에 등록 가능한 테스터 | 25명 (앱 심사 필요) |
| Meta App 심사 통과 시 이론 상한 | 사실상 무제한 (다수 사용자 서비스로 등록) |
| Neon Postgres 단일 프로젝트 | 200GB (Scale plan) — 우리 규모로는 수만 계정도 여유 |
| Threads Graph API rate limit | 계정당 시간 200~1000 requests |

## 지금 설계에 반영된 것

- 코드에 계정 수 하드코딩 없음 (모든 것 config 또는 DB)
- Prisma 스키마는 CUID + 인덱스로 대규모 대응
- BullMQ는 계정 수 무관하게 동작
- Rate limit·비용 알림 모듈이 계정 수 무관하게 트리거

## 미리 준비 필요한 것

- 각 임계점 도달 전에 미리 다음 단계 준비 (예: N=15 도달 시 대시보드 설계 시작)
- Meta App 심사 통과는 사전 준비 필수 (N > 25 도달 전에)
- 계정 팜 프로세스는 별도 검토 (Pipeline D or 외부 조달)

## 관련 문서

- [ADR 008](../08-decisions/008-n-scale-safe.md)
- [cost-model](cost-model.md)
- [deployment](deployment.md)
- [database](database.md)
