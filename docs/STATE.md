---
title: "Current State"
last_updated: "2026-09-01"
status: "active"
---

# Current State — 프로젝트 스냅샷

**새 세션 시작 시 이 파일을 먼저 읽으세요.**

Last updated: 2026-09-01 (Pipeline B 스하리 수집기 착수)
Last commit: `7ac17d7` (실 발행 반영)

## Phase & 진행률

- **Phase**: **4 — 데이터 수집 재설계 중**
- **Task 완료**: 40/41 기존 체크리스트 + **데이터 수집 실 검증 결과 5개 소스 고장 발견**
- **핵심 변경**: 콘텐츠 어댑터 4개 + Google Trends 라이브러리 실 테스트 전멸 → 재설계 진행 중
- Priority 3 (Pipeline A): 8/8 ✅
- Priority 4 (발행): 4/5 (실 발행 테스트만 대기)
- Priority 5 (Source Collector · 벤치마크): 5/5 ✅
- Priority 6 (URL 인제스터): 7/7 ✅
- Priority 7 (자율 트렌드): 8/8 ✅
- **#4c 실 계정 발행 e2e**: ✅ 완료 (2026-09-01) — @kle0_lee threadsPostId 18104792209954978
- **Pipeline B B1**: ✅ 스하리 해시태그 수집기 (2026-09-01) — "스하리1000명프로젝트" 매일 09:00 KST 크론

## 지금까지 검증된 것

| 컴포넌트 | 상태 | 검증 방법 |
|---|---|---|
| Neon Postgres + pgvector 1024 dim | ✅ | 마이그레이션 통과, ivfflat 인덱스 |
| Meta App Live 게시 · 5계정 OAuth | ✅ | 60일 long-lived token · auto refresh |
| Publisher (2-step + carousel + 고정 댓글) | ✅ | 코드 완성, 실 API 호출은 #4c에서 |
| Publisher 스케줄러 (BullMQ delayed) | ✅ | 활성 시간대 · 계정 시차 · 일일 상한 |
| Performance Collector (24h/72h) | ✅ | insights 자동 회수 · engagementScore |
| URL Ingester (4개 플랫폼) | 🔴 재설계 | OG 파싱 전멸 → Apify 전환 중 |
| 다국어·페르소나 Copywriter | ✅ | 원본 언어 무관 · 계정별 재창조 · RAG few-shot |
| 자율 트렌드 (4개 소스) | 🟡 부분 작동 | 쿠팡 ✅ · Google RSS ✅(교체완료) · 네이버 ⚪미설정 · TikTok CC 미검증 |
| 트렌드 → 플랫폼 검색 오케스트레이터 | ✅ | 매일 08:30 · Apify 키워드 검색 · 자동 인제스트 |
| 벤치마크 승격 파이프라인 | ✅ | 자동(likes≥500) + 수동 · 자동 태깅·임베딩 |
| viralFactors AI 태깅 | ✅ | Claude Haiku 6축 분해 (hook·structure·tone·length·cta·topic) |
| Voyage AI 임베딩 + RAG | ✅ | pgvector 코사인 유사도 top-K few-shot |
| Admin UI (로그인·홈·인바운드·트렌드·페르소나·벤치마크·RAG 검색) | ✅ | 세션 쿠키 · DB backed |

## LLM Provider 현황

**LLM_PROVIDER=anthropic** (Gemini fallback으로 코드 유지)

- Anthropic API 크레딧 US$5.00
- Voyage AI: voyage-3 (1024 dim), API 키 사용자 발급 필요

## 진행 중 / 다음

### 🔴 데이터 수집 재설계 (진행 중)

실 URL/API 검증 결과 5개 소스 고장 발견. 전략 v2 수립 완료, 구현 진행 중.

**완료:**
1. ~~Google Trends RSS 교체~~ — `google-trends-api` 라이브러리 제거, RSS 직접 파싱으로 교체
2. ~~Threads/IG 어댑터 Apify 우선 전환~~ — 코드 작성 완료 (Apify 토큰 설정 시 활성화)
3. ~~env.ts에 APIFY_ACTOR_THREADS_URL/IG_URL/TIKTOK_URL 추가~~

**다음:**
4. 텔레그램 `/seed` 텍스트 직접 입력 경로 (Apify 없이 작동하는 최소 경로)
5. TikTok oEmbed 디버깅 (실패 시 Apify 전환)
6. 쿠팡 Search productPrice 매핑 수정

**발행 e2e (#4c)**: 데이터 수집 정상화 후 재개

### 병행 대기 (사용자님)

- **Apify 가입 + 토큰 발급** — Threads/IG/TikTok URL fetch 활성화 핵심 선행
- 네이버 데이터랩 API 신청 (무료, 5분)
- Voyage API 키 재발급 (채팅 노출)
- 5계정 페르소나 편집 (`/admin/personas`)
- 실 발행 시작 결정 (#4c)

## 연결된 Threads 계정 (5개)

| handle | Threads UID | 토큰 만료 |
|---|---|---|
| minyoung.jung | 28425529907071518 | 2026-10-30 |
| pikkseetem | 27965317313149614 | 2026-10-30 |
| sookck.kate | 28466748879586937 | 2026-10-30 |
| kle0_lee | 38438165592448683 | 2026-10-30 |
| _blanchatt_ | 37921878777460515 | 2026-10-30 |

7일 이내 만료 시 Publisher가 자동 refresh · 수동은 `/oauth/threads/accounts`

## Admin 계정

- Username: `Leones` (표시명: 정민영)
- 비번 잊으면 `.env`에 `ADMIN_USERNAME=Leones` + `ADMIN_PASSWORD=<새값>` → 서버 재시작 → 강제 리셋
- CLI: `pnpm admin:list` · `pnpm admin:create`

## Credential 상태

| Key | 상태 | 비고 |
|---|---|---|
| `DATABASE_URL` (Neon) | ✅ | Singapore, pgvector 활성 |
| `COUPANG_ACCESS_KEY` / `SECRET` | ✅ | HMAC 서명 · Best category 통과 |
| `ANTHROPIC_API_KEY` | ✅ | Claude Code workspace |
| `CLOUDINARY_*` | ✅ | `xwqbwrs1` 계정 |
| `META_APP_ID` / `SECRET` | ✅ | Live 게시됨 |
| `META_REDIRECT_URI` | ✅ | GitHub Pages 브리지 |
| `TELEGRAM_BOT_TOKEN` / `ADMIN_CHAT_ID` | ✅ | |
| `ADMIN_USERNAME` / `PASSWORD` | ✅ | 부트스트랩 완료 · DB에 저장 |
| `SESSION_SECRET` | 🟡 | 사용자 25자 · 32자 이상 권장 (경고만) |
| `VOYAGE_API_KEY` | 🟡 | 채팅 노출 → 재발급 · 이름 정정 필요 |
| `NAVER_CLIENT_ID` / `SECRET` | ⚪ | 미설정 (선택) |
| `APIFY_API_TOKEN` | ⚪ | 미설정 (Lane 2 자율 검색·샤오홍슈 조건) |
| `APIFY_ACTOR_*` | ⚪ | 미설정 |

## 서비스 상태

- **Neon**: `pinpoint-threads` 프로젝트, pgvector 1024 dim, 스키마 8개
- **Redis**: 로컬 Docker (`pinpoint-redis`) · BullMQ 큐 10개
- **Meta App**: Live 게시 완료 (2026-08-31), 5계정 OAuth 통과
- **Cloudinary**: `xwqbwrs1`, Free tier
- **Anthropic**: Claude Code workspace, US$5.00 크레딧
- **Voyage AI**: voyage-3, 키 사용자 재발급 대기

## Prisma 스키마

| 모델 | 역할 |
|---|---|
| Account | 발행 계정 (5개) · 페르소나 · 토큰 |
| AdminUser | 관리자 로그인 계정 (bcrypt) |
| SourceItem | 원본 소재 |
| CommerceProduct | 매칭된 쿠팡·무신사 상품 |
| Post | 발행 파이프라인 상태 머신 중심 |
| PostInsightSnapshot | 발행 후 24h/72h 성과 |
| EngagementLog | 팔로우백 액션 이력 (수동 실행 로그) |
| DailyPostCount | 계정별 일일 카운터 |
| SeedSource | 벤치마크 시드 계정 (지금은 축소) |
| BenchmarkPost | 학습·RAG 소스 (viralFactors · pgvector embedding) |
| InboundLink | 유입 URL (Lane 1/2 공통) |
| TrendSignal | 자율 트렌드 시그널 정규화 |

## BullMQ 큐

- `collect`, `classify`, `match-product`, `copywrite`, `approve` (스캐폴딩)
- `publish` (실동작) · `engagement` (스캐폴딩)
- `trend-poll` (6h cron) · `trend-digest` (매일 08:00) · `trend-search` (매일 08:30)
- `performance-collect` (Post 발행 후 24h/72h delayed)

## Admin UI 라우트

- `/admin/login`, `/admin/logout` (인증 없이 접근)
- `/admin` — 홈 (통계 카드)
- `/admin/personas` · `/admin/personas/preview` — 페르소나 편집 · 다국어 프리뷰
- `/admin/inbound` · `/admin/inbound/:id` — 유입 URL 관리 · 승격 · 재인제스트
- `/admin/trends` — 트렌드 시그널 대시보드 · 수동 poll·검색·decay
- `/admin/benchmarks` · `/admin/benchmarks/:id` · `/admin/benchmarks/search` — 벤치마크 목록·상세·태깅·임베딩·RAG 검색
- `/admin/password` — 비번 변경
- `/oauth/threads/start`, `/oauth/threads/callback` (Meta OAuth, 인증 예외)
- `/oauth/threads/accounts` · `/oauth/threads/accounts/:id/refresh|delete`

## 인프라 로드맵

- 지금: 로컬 개발 완료
- 다음: 실 발행 e2e (#4c) 검증 · 각 어댑터·트렌드 소스 실 실행 검증
- 그 후: **호스팅 이전** ([deployment.md](03-infrastructure/deployment.md) 참조)
  - 권장: Hetzner CX22 ($5/월) + Cloudflare Tunnel + Access
  - 무료 대안: Oracle Cloud Always Free ARM (셋업 3~4시간)
- 스케일 후: 티어 상향 · 프록시

## 갱신 규칙

- **매 커밋 시 갱신** — 커밋 hash, 완료된 항목 반영
- **credential 변경 시 즉시 갱신** — 실제 값은 안 씀, 상태만
- **Phase 전환 시 대폭 갱신**

## 관련 문서

- [TASKS.md](TASKS.md)
- [ROADMAP.md](ROADMAP.md)
- [INDEX.md](INDEX.md)
- [session-log/](session-log/)
- [03-infrastructure/admin-auth.md](03-infrastructure/admin-auth.md)
- [00-overview/vision.md](00-overview/vision.md)
