---
title: "Current State"
last_updated: "2026-08-31"
status: "active"
---

# Current State — 프로젝트 스냅샷

**새 세션 시작 시 이 파일을 먼저 읽으세요.**

Last updated: 2026-08-31
Last commit: Phase 4 진입 커밋 (OAuth + Publisher)

## Phase & 진행률

- **Phase**: **4 진입 + Vision 2-Lane 아키텍처 확정** (2026-08-31, 사용자 없이도 시스템이 자율 운영)
- **Task 완료**: 19/41 (46%)
- **Priority 3 (Pipeline A 실 구현)**: 8/8 ✅
- **Priority 4 (발행 파이프라인)**: 2/5 (17 OAuth · 18 Publisher 완료, 19-21 보류)
- **Priority 5 (Source Collector — 축소·부가)**: 1/5 (스키마 완료, 나머지 재정의)
- **Priority 6 (URL 인제스터 — Lane 1 · 하류 공통)**: 0/7
- **Priority 7 (자율 트렌드 추적 — Lane 2)**: 0/8 (신규 · 시스템 자율성의 핵심)
- **다음 Milestone**: Lane 1(6a-6c) + Lane 2 Stage 1(7a-7e) 병행 착수

## 지금까지 검증된 것

| 컴포넌트 | 상태 | 검증 방법 |
|---|---|---|
| Neon Postgres + pgvector | ✅ | migrate deploy 통과, 확장 확인 |
| Cloudinary 미디어 호스팅 | ✅ | Cloud name 확보 |
| Coupang HMAC + Search + Deeplink | ✅ | 실 API 통신 검증 (`/coupang`, `/deeplink`) |
| Content Classifier | ✅ | `/classify` JSON 응답 정상 |
| Copywriter 4양식 다변화 | ✅ | `/copy 1~4` 모두 정확 |
| Reply Composer | ✅ | AI 감초 톤 매번 생성 |
| Media Handler | ✅ | uploadFromUrl 구현 |
| Telegram 승인 UI | ✅ | 인라인 키보드 콜백 → 상태 전이 |
| 12-module 재구조화 | ✅ | infra/ + modules/ 완료 |
| Meta App **Live 게시** | ✅ | 개인정보처리방침 URL 등록 후 통과 |
| Threads OAuth 흐름 (Task #17) | ✅ | 5계정 실 연결 완료 (60일 토큰) |
| Publisher 실 구현 (Task #18) | ✅ | 2-step + carousel + 고정 댓글, 실 API 호출은 Task #19에서 |
| Vision Verifier | ✅ | `/vision` Anthropic Sonnet base64 인라인, 0.05 판정 정확 |
| Product Matcher 통합 | ✅ | `/matcher` 실 검증, score 0.75, 1회 시도, deeplink 생성 |

## LLM Provider 현황

**LLM_PROVIDER=anthropic** (Gemini free tier RPD 제한·모델 호환성 이슈로 전환)

- Anthropic API 크레딧 US$5.00 (Claude Code workspace)
- 새 API 키 발급 후 .env 반영, 이미지는 base64 인라인 방식
- Gemini 코드도 남아있어 필요 시 스위치 가능 (`LLM_PROVIDER=gemini`)

## 진행 중 / 다음

**2026-08-31 vision 재정립:** 자동 폴링 → **수동 URL 시딩 + AI 재창조** 모델로 대전환. 상세 근거는 [vision.md](00-overview/vision.md) 2026-08-31 재정립 섹션.

### 다음 세션 착수 (Priority 6 URL 인제스터)

- **#6a URL Ingester 프레임워크** — 텔레그램 봇에 URL 라우팅, 플랫폼 감지
- **#6b Threads URL Adapter** — 첫 어댑터, 인터페이스 표준 정립
- **#6c 다국어·페르소나 Copywriter 확장** — 소재만 취하고 계정별 완전 재창조 ★핵심
- **#6d 계정별 페르소나 관리 UI** — 5계정 각자 컨셉 정의
- **#6e/f/g** — TikTok · 샤오홍슈 · Instagram Adapter 순차

### 축소·후순위

- **Priority 5 (Source Collector)**: 시드 5개 소규모 부가 기능화, 자동 폴링 폐기
- **Priority 4 잔여 (#19-21)**: 인제스터 안정화 후 발동

### 병행 가능 (사용자)

- 강의 영상 녹화 (하루 1개씩 ~10일)
- 5계정 각각 컨셉·페르소나 방향 잡기 (#6d 착수 시 반영)

## 연결된 Threads 계정 (5개)

| handle | Threads UID | 토큰 만료 |
|---|---|---|
| minyoung.jung | 28425529907071518 | 2026-10-30 |
| pikkseetem | 27965317313149614 | 2026-10-30 |
| sookck.kate | 28466748879586937 | 2026-10-30 |
| kle0_lee | 38438165592448683 | 2026-10-30 |
| _blanchatt_ | 37921878777460515 | 2026-10-30 |

7일 이내 만료 시 Publisher가 자동 refresh. 수동 refresh는 `/oauth/threads/accounts` 페이지.

## Credential 상태

| Key | 상태 | 비고 |
|---|---|---|
| `DATABASE_URL` (Neon) | ✅ 설정됨 | Singapore region |
| `COUPANG_ACCESS_KEY` | ✅ | 실 API 통과 확인 |
| `COUPANG_SECRET_KEY` | ✅ | HMAC 서명 통과 |
| `GEMINI_API_KEY` | ✅ | 있으나 현재 미사용 |
| `ANTHROPIC_API_KEY` | ✅ | Claude Code workspace, never expires |
| `CLOUDINARY_CLOUD_NAME` | ✅ | `xwqbwrs1` |
| `CLOUDINARY_API_KEY` | ✅ | |
| `CLOUDINARY_API_SECRET` | ✅ | 사용자 .env 입력 완료 |
| `META_APP_ID` | ✅ | 저장됨 |
| `META_APP_SECRET` | ✅ | 재발급 완료 |
| `TELEGRAM_BOT_TOKEN` | ✅ | 봇 롱폴링 정상 |
| `TELEGRAM_ADMIN_CHAT_ID` | ✅ | |

## 서비스 상태

- **Neon**: `pinpoint-threads` 프로젝트, ap-southeast-1, Free tier
- **Redis**: 로컬 Docker (`pinpoint-redis`)
- **Meta App**: **Live 게시 완료** (2026-08-31). 개인정보처리방침 URL: `outlawleojung.github.io/pinpoint-legal/privacy.html`. OAuth 콜백은 GitHub Pages 브리지 → localhost 릴레이 방식
- **Cloudinary**: `xwqbwrs1` 계정, Free tier
- **Anthropic**: Claude Code workspace, US$5.00 크레딧, LLM_PROVIDER 활성

## 주의 사항

- **Telegram 봇 debug 명령** — Phase 4 이후 관리자 전용 or 제거 예정

## 미결 전략 논의

- **무신사 큐레이터 활용 방식** (2026-08-28 논의 - 공식 가이드 확인)
  - 상세: [docs/08-decisions/pending-musinsa-strategy.md](08-decisions/pending-musinsa-strategy.md)
  - 잠정 전략: 큐레이터샵 세팅부터 시작 (수동), 상품 개별 자동화는 API 확인 후
- **Threads API 팔로우 엔드포인트 없음** (2026-08-29 확인)
  - Pipeline B 반하리는 반자동으로 결정 (감지는 시스템, 팔로우는 사용자)
  - 상세: [docs/01-pipelines/B-suhari.md § 9.3](01-pipelines/B-suhari.md)

## 인프라 로드맵

- 지금: 로컬 개발
- Phase 4 (Meta 승인 후): 로컬 유지, 4~5계정 발행 검증
- 수익 검증 후: Hetzner VPS 티어 1 ($6/월) 이전
- 스케일 후: 티어 2~3 (프록시, 다중 IP)

## 갱신 규칙

- **매 커밋 시 갱신** — 커밋 hash, 완료된 항목 반영
- **credential 변경 시 즉시 갱신** — 실제 값은 안 씀, 상태만
- **Phase 전환 시 대폭 갱신** — 다음 목표 명시

## 관련 문서

- [TASKS.md](TASKS.md)
- [ROADMAP.md](ROADMAP.md)
- [INDEX.md](INDEX.md)
- [session-log/](session-log/)
