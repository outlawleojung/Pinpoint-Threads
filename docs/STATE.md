# Current State — 프로젝트 스냅샷

**새 세션 시작 시 이 파일을 먼저 읽으세요.**

Last updated: 2026-08-28 16:15
Last commit: `4e5f5cb`

## Phase & 진행률

- **Phase**: 3 (실 구현 진행 중)
- **Task 완료**: 13/21 (62%)
- **다음 Milestone**: 3h Pipeline A e2e 검증 (모든 A 파이프라인 노드 조립)

## 지금까지 검증된 것

| 컴포넌트 | 상태 | 검증 방법 |
|---|---|---|
| Neon Postgres + pgvector | ✅ | migrate deploy 통과, 확장 확인 |
| Cloudinary 미디어 호스팅 | ✅ | Cloud name 확보, 인증만 사용자 몫 |
| Coupang HMAC + Search + Deeplink | ✅ | 실 API 통신 검증 (`/coupang`, `/deeplink`) |
| Content Classifier (Gemini fast) | ✅ | `/classify` JSON 응답 정상 |
| Copywriter 4양식 다변화 | ✅ | `/copy 1~4` 모두 실전 4양식 정확 |
| Reply Composer | ✅ | 계정×요일 해시 다변화, 공정위 강제 |
| Media Handler | ✅ | uploadFromUrl 구현, 2개 이상 하드 룰 |
| Telegram 승인 UI | ✅ | 인라인 키보드 4버튼, 콜백 → 상태 전이 |
| 12-module 재구조화 | ✅ | src/infra + src/modules 완료, typecheck 통과 |
| Meta App 등록 & 5 테스터 | ✅ | 개발 모드, threads_basic/content_publish/etc |

## 진행 중

- **Task #13 Product Matcher 통합** — `/matcher` 명령 구현 완료, 사용자님 실 검증 대기

## 다음 우선 순위

1. `/matcher` 사용자 실 테스트로 Task #13 완료
2. `/vision` 실행하여 Task #10 완료
3. Task #16 Pipeline A e2e 검증 (전체 흐름 조립)
4. Task #4 (Apify) — 사용자님 병렬
5. Meta 앱 승인 후 Phase 4 진입

## Credential 상태

| Key | 상태 | 비고 |
|---|---|---|
| `DATABASE_URL` (Neon) | ✅ 설정됨 | 채팅 공유됨, 나중에 재발급 가능 |
| `COUPANG_ACCESS_KEY` | ✅ 사용자 입력됨 | 실 API 통과 확인 |
| `COUPANG_SECRET_KEY` | ✅ 사용자 입력됨 | HMAC 서명 통과 확인 |
| `GEMINI_API_KEY` | ✅ 사용자 입력됨 | 실 호출 확인 |
| `CLOUDINARY_CLOUD_NAME` | ✅ | 공개 값 |
| `CLOUDINARY_API_KEY` | ✅ | 공개 값 |
| `CLOUDINARY_API_SECRET` | ⏳ | **사용자님이 .env에 직접 입력 필요** |
| `META_APP_ID` | ✅ 저장됨 | `1055715417182617` (부모), `994801270245194` (Threads) |
| `META_APP_SECRET` | ⚠️ | **노출된 값 재발급 필요** |
| `TELEGRAM_BOT_TOKEN` | ✅ | 봇 롱폴링 정상 |
| `TELEGRAM_ADMIN_CHAT_ID` | ✅ | 승인 알림 정상 |
| `ANTHROPIC_API_KEY` | ⏳ | 크레딧 0. 필요 시 충전 후 `LLM_PROVIDER=anthropic`로 재전환 가능 |

## 서비스 상태

- **Neon**: `pinpoint-threads` 프로젝트, AWS ap-southeast-1 (Singapore), Free tier
- **Redis**: 로컬 Docker (`pinpoint-redis`)
- **Meta App**: 개발 모드, 5 테스터 수락 완료. Threads API 심사 진행 상황 미확인
- **Cloudinary**: `xwqbwrs1` 계정, Free tier
- **Gemini**: `gemini-3.5-flash` (main) + `gemini-3.5-flash-lite` (fast). thinking mode 꺼짐

## 주의 사항

- **`META_APP_SECRET` 노출 상태** — 사용자님이 재발급 후 .env 갱신 필요
- **Anthropic 크레딧 0** — Gemini로 임시 전환됨, 필요 시 크레딧 충전 후 스위치백
- **Telegram 봇 debug 명령** (`/classify`, `/copy`, `/vision`, `/coupang`, `/deeplink`, `/matcher`, `/newpost`) — Phase 4 이후 관리자 전용 or 제거 예정

## 인프라 로드맵

- 지금: 로컬 개발
- Phase 4 (Meta 승인 후): 로컬 유지, 4계정 발행 검증
- 수익 검증 후: Hetzner VPS 티어 1 ($6/월) 이전
- 스케일 후: 티어 2~3 (프록시, 다중 IP)

## 갱신 규칙

- **매 커밋 시 갱신** — 커밋 hash, 완료된 항목만 반영
- **credential 변경 시 즉시 갱신** — 실제 값은 절대 안 씀, 상태만
- **Phase 전환 시 대폭 갱신** — 다음 목표 명시

## 관련 문서

- [TASKS.md](TASKS.md) — 태스크 체크리스트
- [ROADMAP.md](ROADMAP.md) — Priority 매트릭스
- [INDEX.md](INDEX.md) — 전체 문서 카탈로그
- [session-log/](session-log/) — 세션별 인수인계
