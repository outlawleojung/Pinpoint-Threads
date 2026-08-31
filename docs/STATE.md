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

- **Phase**: **4 진입 + Source Collector 시작** (프로젝트 핵심 기능으로 우선순위 재정렬)
- **Task 완료**: 19/26 (73%)
- **Priority 3 (Pipeline A 실 구현)**: 8/8 ✅
- **Priority 4 (발행 파이프라인)**: 2/5 (17 OAuth · 18 Publisher 완료, 19-21 보류)
- **Priority 5 (Source Collector — ★핵심)**: 1/5 (22 스키마 완료)
- **다음 Milestone**: Apify 세팅 → Task #5b Source Collector 코어

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

**우선순위 재정렬 (2026-08-31 세션 후반):** 사용자 요청으로 Source Collector(벤치마크 수집·분석)가 Priority 4 잔여작업보다 우선. 이것이 프로젝트의 핵심 기능(터진 콘텐츠 재생산).

- **Task #5b Source Collector 코어** — 대기: 사용자 Apify 가입 + 액터 선정 (다음 세션)
- **Task #5c Admin UI · #5d viralFactors 태깅 · #5e 임베딩** — 순차 진행
- **Task #19-21 (Publisher 잔여)** — Source Collector 안정화 후 재개
- 병행 가능: 강의 영상 녹화 (사용자 — 하루 1개씩, ~10일)
- 병행 가능: Pipeline B/C 상세 설계

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
