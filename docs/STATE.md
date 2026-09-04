---
title: "Current State"
last_updated: "2026-09-03"
status: "active"
---

# Current State — 프로젝트 스냅샷

**새 세션 시작 시 이 파일을 먼저 읽으세요.**

Last updated: 2026-09-03 (상품명 기반 수동 발행 흐름 · 텔레그램 쿠팡링크 차단 회피 · 비용 절감)
Last commit: `ce79ade` (perf: LLM 비용 절감)
직전 세션 로그: [docs/session-log/2026-09-03.md](session-log/2026-09-03.md)

### 핵심 흐름 (2026-09-03 후반 확정) — [manual-shopping-flow](08-decisions/manual-shopping-flow.md)
- **텔레그램은 쿠팡 링크 전송 차단** → 사용자는 **벤치마크 URL + 상품명(텍스트)** 만 보냄
- 상품명 → 쿠팡 검색 → productUrl(itemId 포함) → 딥링크 자동 생성 → 특징 반영 카피 → 승인 카드
- `productNameHint` · `trustKeyword` · `InboundLink.manualProductName` · Threads `/share/` URL 해석

## Phase & 진행률

- **Phase**: **4-말 (배포 직전) · 프로덕션 파이프 실 발행 검증 완료**
- **초기 태스크**: 49/49 완료 (Priority 1~7 · B1~B5 · Task #46~49)
- **다음 마일스톤**: 클라우드 배포 (사용자 하드캡 결제 이슈로 결정 보류)

### 2026-09-03 실 발행 e2e 검증 (쇼핑)
- ✅ **Pipeline A 쇼핑 자동발행 실 발행 성공**: 열무김치·minyoung.jung (쿠팡), 슬리퍼·pikkseetem (무신사) — 본문+미디어+고정댓글
- ✅ **Threads 비디오 정확 추출**: shortcode 매칭으로 target 게시글 비디오만 (추천글 오염 제거)
- ✅ **매칭 실패 → URL 답장 흐름**: 대기 카드 → 사용자 커머스 URL 답장 → 하이브리드 재실행 (쿠팡·무신사·네이버)
- ✅ **수동 승인=즉시 발행** · 자동 크론만 계정 시차
- ✅ **본문·reply 자동 재시도** (Threads 비디오 컨테이너 일시 ERROR 복구)
- ✅ **채널별 공정위 문구** (쿠팡/무신사 큐레이터/네이버 제휴)
- ✅ **완성 딥링크(link.coupang.com/a) 직접 사용** (축약 URL 변환 실패 회피)
- ⚠️ **상품 다양성**: 자동 매칭 vision-failed 잦음 → 하이브리드 URL 붙은 벤치마크만 실질 발행 · 사용자 큐레이션 필요
- ⚠️ **미검증**: 앨범 답장 매칭 fix(7c07512) 후 텔레그램 실제 답장 e2e (지금까진 스크립트 우회)

### 주요 달성 (2026-09-01 · 09-02)
- ✅ **#4c 실 발행 e2e**: @kle0_lee 첫 실 게시 (2026-09-01)
- ✅ **Pipeline B 스하리** 3단 완주: 수집기(B1) · RAG 각색기(B2) · 발행 스케줄(B3)
- ✅ **계정 컨텍스트 매일 sync** (B5): 팔로워 수 + 계정 나이 → 각색 정합성
- ✅ **#46 하이브리드 상품 매칭**: 텔레그램에 벤치마크 URL + Coupang URL 함께 → Deeplink API 파트너스 링크 자동 변환
- ✅ **#47 Threads 비디오 지원**: Playwright 익명 (로그인 X · 계정 안전) · mp4 → Cloudinary /video/upload · Threads VIDEO container
- ✅ **#48 쇼핑 자동 발행 스케줄**: 매일 09:00 카피 생성 · 계정 시차 slot · 승인 카드 스킵 (완전 자동)
- ✅ **#49 계정↔상품 성별 필터**: 남성 계정 ↔ 여성 상품 자동 차단
- ✅ **트렌드 재설계**: Coupang Ranking 패션·뷰티 3개 카테고리로 좁힘 · LLM 필터에 "패션·뷰티 유행템만 keep"
- ✅ **MANUAL_TELEGRAM 자동 승격 복구**: 사용자 큐레이션 판단 있으므로 likes 무관 승격

## 지금까지 검증된 것

| 컴포넌트 | 상태 | 검증 방법 |
|---|---|---|
| Neon Postgres + pgvector 1024 dim | ✅ | 마이그레이션 통과, ivfflat 인덱스 |
| Meta App Live 게시 · 5계정 OAuth | ✅ | 60일 long-lived token · auto refresh |
| Publisher (2-step + carousel + 고정 댓글) | ✅ | 실 발행 검증 · 비디오 reply 15초 대기 + 재시도 4회 |
| Publisher 스케줄러 (BullMQ delayed) | ✅ | 활성 시간대 · 계정 시차 · 일일 상한 |
| Performance Collector (24h/72h) | ✅ | insights 자동 회수 · engagementScore |
| URL Ingester (4개 플랫폼) | ✅ | Apify 통합 · Threads·IG·TikTok·XHS 각각 실 e2e 완료 |
| 다국어·페르소나 Copywriter | ✅ | 원본 언어 무관 · 계정별 재창조 · RAG few-shot |
| **Threads 비디오 추출** | ✅ | Playwright 익명 헤드리스 · mp4 URL 캡처 · Cloudinary 비디오 업로드 |
| **하이브리드 상품 매칭** | ✅ | Coupang URL 자동 페어링 · Deeplink API 파트너스 변환 |
| 자율 트렌드 (4개 소스) | 🟡 부분 | 쿠팡 ✅(재설계 완료) · Google RSS ✅ · TikTok CC ✅ · 네이버 ⚪(카드 요구로 스킵) |
| 트렌드 → 플랫폼 검색 오케스트레이터 | ✅ | 매일 08:30 · Apify 키워드 검색 · 자동 인제스트 |
| 벤치마크 승격 파이프라인 | ✅ | MANUAL_TELEGRAM 무조건 승격 · AUTONOMOUS_TREND likes≥500 · 자동 태깅·임베딩 |
| viralFactors AI 태깅 (7축) | ✅ | Claude Haiku · hook·structure·tone·length·cta·topic + **audience** (성별 필터용) |
| Voyage AI 임베딩 + RAG | ✅ | pgvector 코사인 유사도 top-K few-shot |
| **스하리 각색 (B2)** | ✅ | 훅 유형별(N일차·모집·질문·겸손·발견·진행형·오래하는중) · 계정 나이/팔로워 정합 |
| **스하리 발행 스케줄 (B3)** | ✅ | 매일 09:00 · 승인 카드 → 사용자 승인 후 발행 |
| **쇼핑 자동 발행 스케줄 (#48)** | ✅ | 매일 09:00 카피 · 계정별 시차 slot 10:00~22:30 · 완전 자동 |
| Admin UI (로그인·홈·인바운드·트렌드·페르소나·벤치마크·RAG 검색) | ✅ | 세션 쿠키 · DB backed |

## 매일 크론 스케줄 (KST)

| 시각 | Job | 목적 |
|---|---|---|
| 07:30 | account-metrics-sync | 5계정 팔로워·나이 sync (Threads API) |
| 08:00 | sharing-collect-daily | "스하리1000명프로젝트" 해시태그 벤치마크 신규 수집 |
| 08:00 (6h interval) | trend-poll | 자율 트렌드 시그널 poll (Coupang·Google·TikTok CC) |
| 08:00 | trend-digest | 오늘 상위 트렌드 텔레그램 다이제스트 |
| 08:30 | trend-search | 트렌드 키워드로 Apify 검색 → 자동 인제스트 |
| 09:00 | sharing-publish-daily | 스하리 카피 생성 → 5계정 승인 카드 |
| 09:00 | shopping-publish-daily | 쇼핑 카피 생성 → 계정별 시차 slot 예약 (자동 발행) |
| 10:00~22:30 | (publish queue delayed) | 쇼핑 slot 시각 도래 시 자동 발행 |

## 계정 시차 발행 slot (쇼핑 자동)

| 계정 idx | 계정 | slot 1 | slot 2 |
|---|---|---|---|
| 0 | (첫 계정) | 10:00 | 17:00 |
| 1 | | 11:30 | 18:30 |
| 2 | | 13:00 | 20:00 |
| 3 | | 14:30 | 21:30 |
| 4 | | 16:00 | 22:30 |

## 연결된 Threads 계정 (5개)

| handle | audienceGender | Threads UID | 토큰 만료 |
|---|---|---|---|
| minyoung.jung | **male** | 28425529907071518 | 2026-10-30 |
| pikkseetem | female | 27965317313149614 | 2026-10-30 |
| sookck.kate | female | 28466748879586937 | 2026-10-30 |
| kle0_lee | female | 38438165592448683 | 2026-10-30 |
| _blanchatt_ | female | 37921878777460515 | 2026-10-30 |

7일 이내 만료 시 Publisher 자동 refresh · 수동은 `/oauth/threads/accounts`

## Admin 계정

- Username: `Leones` (표시명: 정민영)
- 비번 잊으면 `.env` `ADMIN_USERNAME`/`ADMIN_PASSWORD` 세팅 → 서버 재시작 → 강제 리셋
- CLI: `pnpm admin:list` · `pnpm admin:create`

## Credential 상태

| Key | 상태 | 비고 |
|---|---|---|
| `DATABASE_URL` (Neon) | ✅ | Singapore, pgvector 활성 |
| `COUPANG_ACCESS_KEY` / `SECRET` | ✅ | HMAC 서명 · Deeplink API · 파트너스 링크 확인됨 |
| `ANTHROPIC_API_KEY` | ✅ | Claude Code workspace |
| `CLOUDINARY_*` | ✅ | `xwqbwrs1` · 이미지 + 비디오 업로드 |
| `META_APP_ID` / `SECRET` | ✅ | Live 게시 · 5계정 OAuth |
| `META_REDIRECT_URI` | ✅ | GitHub Pages 브리지 |
| `TELEGRAM_BOT_TOKEN` / `ADMIN_CHAT_ID` | ✅ | |
| `ADMIN_USERNAME` / `PASSWORD` | ✅ | 부트스트랩 완료 · DB에 저장 |
| `SESSION_SECRET` | 🟡 | 사용자 25자 · 32자 이상 권장 |
| `VOYAGE_API_KEY` | 🟡 | rate limit (무료 3 RPM · 유료 upgrade 필요) |
| `APIFY_API_TOKEN` | ✅ | Threads/IG/TikTok/XHS 어댑터 통합 활성 |
| `APIFY_ACTOR_*` | ✅ | THREADS_URL(themineworks) · IG_URL(apify) · TIKTOK_URL(clockworks) · XHS(zen-studio) · THREADS_KEYWORD |
| `NAVER_CLIENT_ID` / `SECRET` | ⚪ | 미설정 (NCP 신용카드 요구로 skip) |

## 서비스 상태

- **Neon**: `pinpoint-threads` 프로젝트, pgvector 1024 dim, 스키마 12개
- **Redis**: 로컬 Docker (`pinpoint-redis`) · BullMQ 큐 13개
- **Meta App**: Live · 5계정 OAuth · 실 발행 검증 완료
- **Cloudinary**: `xwqbwrs1`, Free tier · 이미지+비디오 지원
- **Anthropic**: Claude Sonnet 5 (main) · Haiku 4.5 (fast)
- **Voyage AI**: voyage-3 (1024 dim) · 무료 티어 rate limit (임베딩 커버리지 부분적)
- **Apify**: themineworks/threads-scraper · clockworks/tiktok · apify/instagram · zen-studio/xhs

## Prisma 스키마

| 모델 | 역할 |
|---|---|
| Account | 발행 계정 (5개) · **audienceGender** · 페르소나 · 팔로워·나이 캐시 |
| AdminUser | 관리자 로그인 계정 (bcrypt) |
| SourceItem | 원본 소재 |
| CommerceProduct | 매칭된 쿠팡·무신사 상품 |
| Post | 발행 파이프라인 상태 머신 · **kind (SHOPPING/SHARING/DAILY)** |
| PostInsightSnapshot | 발행 후 24h/72h 성과 |
| EngagementLog | 팔로우백 액션 이력 |
| DailyPostCount | 계정별 일일 카운터 |
| SeedSource | 벤치마크 시드 계정 |
| BenchmarkPost | 학습·RAG 소스 · **contentType (SHOPPING/DAILY/SHARING/UNSUITABLE)** · viralFactors (7축 · audience 포함) · pgvector embedding |
| InboundLink | 유입 URL · **manualCommerceUrl** (하이브리드 매칭) |
| TrendSignal | 자율 트렌드 시그널 정규화 |

## BullMQ 큐 (13개)

- 파이프라인: `collect`, `classify`, `match-product`, `copywrite`, `approve`
- 발행: `publish`, `engagement`
- 트렌드: `trend-poll`, `trend-digest`, `trend-search`
- 스하리: `sharing-collect`, `sharing-publish`
- 쇼핑 자동: `shopping-publish`
- 계정 sync: `account-metrics-sync`
- 성과: `performance-collect`

## Admin UI 라우트

- `/admin/login`, `/admin/logout` (인증 없이)
- `/admin` — 홈 (통계)
- `/admin/personas` · `/preview` — 페르소나 편집 · 다국어 프리뷰
- `/admin/inbound` · `/admin/inbound/:id` — 유입 URL 관리 · 승격 · 재인제스트
- `/admin/trends` — 트렌드 시그널 대시보드
- `/admin/benchmarks` · `/:id` · `/search` — 벤치마크 목록·상세·태깅·임베딩·RAG 검색
- `/admin/password` — 비번 변경
- `/oauth/threads/start`, `/callback` (Meta OAuth)
- `/oauth/threads/accounts` · `/:id/refresh|delete`

## 인프라 · 배포 상태

- **현재**: 로컬 개발 서버 (dev/worker)
- **결정**: 배포 옵션 검토 완료. 결제 하드캡 이슈로 사용자 결정 보류 상태.
  - AWS Lightsail Seoul $5/월 (flat rate, 하드캡 X)
  - Vultr Seoul + 선불 크레딧 (하드캡 O)
  - Naver Cloud (개인은 후불이라 하드캡 X)
  - Fly.io (spend limit 하드캡 O)
- **관련 문서**: [docs/03-infrastructure/deployment-decision.md](03-infrastructure/deployment-decision.md)

## 주요 알려진 이슈

1. **Threads 자동 링크 프리뷰 카드** — Meta API로 억제 불가 (oEmbed 앱 심사 대기 or 프로필 링크로 이동 대안)
2. **Voyage 무료 티어 rate limit** — 3 RPM · 임베딩 부분 실패 (RAG 커버리지 저하)
3. **비디오 벤치마크는 원본 이미지 재사용** — 커버 프레임 + 원본 이미지 · Playwright로 mp4 대체 (썸네일 아이덴티피케이션 미검증)

## 다음 마일스톤 · 대기 중

- **B4. 팔로우백 액션** — 하드 캡 3~5/일 · 사용자 승인만 (자동 X · 계정 리스크)
- **Pipeline C 일상글** — 소스 방식 결정 필요
- **강의 학습 이식** — 사용자님 녹화 대기 (Whisper 전사 파이프 골격만 있음)
- **클라우드 배포** — 사용자 결제 방식 결정 대기
- **Meta oEmbed 앱 심사** — 링크 프리뷰 카드 억제 목적 (수주 소요)

## 갱신 규칙

- **매 커밋 시 갱신** — 커밋 hash · 완료된 항목 반영
- **credential 변경 시 즉시 갱신**
- **Phase 전환 시 대폭 갱신**

## 관련 문서

- [TASKS.md](TASKS.md)
- [session-log/](session-log/)
- [INDEX.md](INDEX.md)
- [03-infrastructure/deployment-decision.md](03-infrastructure/deployment-decision.md)
- [09-backlog/image-replacement-and-naver.md](09-backlog/image-replacement-and-naver.md)
