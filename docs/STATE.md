---
title: "Current State"
last_updated: "2026-08-28"
status: "active"
---

# Current State — 프로젝트 스냅샷

**새 세션 시작 시 이 파일을 먼저 읽으세요.**

Last updated: 2026-08-28 17:15
Last commit: `d8b0c3c` (pending: Reply Composer 재설계 반영)

## Phase & 진행률

- **Phase**: 3 → 완료 임박 (Priority 3 100% 예상)
- **Task 완료**: 16/21 (76%)
- **Priority 3 (Pipeline A 실 구현)**: 8/8 ✅
- **다음 Milestone**: Meta 승인 대기 → Phase 4 (Publisher)

## 지금까지 검증된 것

| 컴포넌트 | 상태 | 검증 방법 |
|---|---|---|
| Neon Postgres + pgvector | ✅ | migrate deploy 통과, 확장 확인 |
| Cloudinary 미디어 호스팅 | ✅ | Cloud name 확보 |
| Coupang HMAC + Search + Deeplink | ✅ | 실 API 통신 검증 (`/coupang`, `/deeplink`) |
| Content Classifier | ✅ | `/classify` JSON 응답 정상 |
| Copywriter 4양식 다변화 | ✅ | `/copy 1~4` 모두 정확 |
| Reply Composer | ✅ | 계정×요일 해시 다변화 |
| Media Handler | ✅ | uploadFromUrl 구현 |
| Telegram 승인 UI | ✅ | 인라인 키보드 콜백 → 상태 전이 |
| 12-module 재구조화 | ✅ | infra/ + modules/ 완료 |
| Meta App 등록 & 5 테스터 | ✅ | 개발 모드 활성 |
| **Vision Verifier** | ✅ **NEW** | `/vision` Anthropic Sonnet base64 인라인, 0.05 판정 정확 |
| **Product Matcher 통합** | ✅ **NEW** | `/matcher` 실 검증, score 0.75, 1회 시도, deeplink 생성 |

## LLM Provider 현황

**LLM_PROVIDER=anthropic** (Gemini free tier RPD 제한·모델 호환성 이슈로 전환)

- Anthropic API 크레딧 US$5.00 (Claude Code workspace)
- 새 API 키 발급 후 .env 반영, 이미지는 base64 인라인 방식
- Gemini 코드도 남아있어 필요 시 스위치 가능 (`LLM_PROVIDER=gemini`)

## 진행 중 / 다음

- 다음 우선 순위 1: **Task #3h Pipeline A e2e** — 모든 노드 조립 검증
- 다음 우선 순위 2: Task #4 Apify (사용자 액션 대기)
- Meta 앱 승인 후 Phase 4 진입

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
- **Meta App**: 개발 모드, 5 테스터 수락 완료. Threads API 심사 진행 중 여부 미확인
- **Cloudinary**: `xwqbwrs1` 계정, Free tier
- **Anthropic**: Claude Code workspace, US$5.00 크레딧, LLM_PROVIDER 활성

## 주의 사항

- **Telegram 봇 debug 명령** — Phase 4 이후 관리자 전용 or 제거 예정

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
