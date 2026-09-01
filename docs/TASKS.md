# Tasks — 영구 진행 상황

**이 파일은 Task tool의 세션-스코프 상태를 대체합니다.** 새 세션 시작 시 여기서 상태를 확인하고, 완료 시 체크박스를 업데이트.

Last synced: 2026-08-31 (데이터 수집 재검증 후)

**진행률: 40/41 기존 태스크 + 데이터 수집 재설계 진행 중**
**⚠️ 주의: Priority 6 (URL 인제스터) · Priority 7 (자율 트렌드) 실 검증 결과 5개 소스 고장 발견.**

## Priority 1 — 외부 세팅 (사용자 + 저)

- [x] **1a. Meta App 등록 & Threads API 신청** — Live 게시 완료
- [x] **1b. Neon Postgres 프로젝트 생성** — ap-southeast-1, pgvector 0.8.6
- [x] **1c. Cloudinary 계정 & API Key** — Cloud name `xwqbwrs1`
- [ ] **1d. Apify Threads Actor 무료 시험** — 사용자님 몫 (Optional)
- [x] **1e. 5개 Threads 계정 상태 점검** — 모두 OAuth 연결 완료

## Priority 2 — 기반 인프라 (저)

- [x] **2a. 로컬 Postgres → Neon 이관**
- [x] **2b. pgvector 활성화** — 확장 · BenchmarkPost·TrendSignal·InboundLink 스키마
- [x] **2d. src 12-module 재구조화**

## Priority 3 — Pipeline A 실 구현 (저)

- [x] **3a. Coupang HMAC + Search + Deeplink**
- [x] **3b. Vision Verifier 실 테스트**
- [x] **3c. Content Classifier 실 테스트**
- [x] **3d. Copywriter 카피 품질 검증**
- [x] **3e. Product Matcher 통합**
- [x] **3f. Media Handler** — Cloudinary uploadFromUrl / uploadManyFromUrls
- [x] **3g. Reply Composer** — AI 감초 톤
- [x] **3h. Pipeline A e2e 검증** — `/pa` 통과

## Priority 4 — 발행 파이프라인

- [x] **4a. Threads OAuth 흐름** — 5계정 실 연결, `/oauth/threads/accounts` UI
- [x] **4b. Publisher** — 2-step + carousel + 고정 댓글 + refresh 자동화
- [x] **4c. 실 계정 1개 발행 e2e** — @kle0_lee 발행 완료 (threadsPostId 18104792209954978, 2026-09-01)
  - **선행: Publisher dryRun 모드 구현** (container-only, 실 게시 안 함 · 5계정 리스크 0 검증)
  - 상세: [docs/03-infrastructure/publisher-dryrun-testing.md](03-infrastructure/publisher-dryrun-testing.md)
  - dry-run 5계정 검증 통과 후 → 최소 팔로워 계정 1개로 실 게시 1회 · 방치
- [x] **4d. 계정 시차 스케줄링** — BullMQ delayed · 활성 시간대 · 일일 상한
- [x] **4e. Performance Collector** — 24h/72h insights 자동 회수 · engagementScore

## Priority 5 — Source Collector · 벤치마크 (저)

2026-08-31 vision 재정립으로 Source Collector 축소. 주력은 Priority 6 URL 인제스터.

- [x] **5a. Prisma 스키마** — SeedSource · BenchmarkPost · InboundLink · TrendSignal · PostInsightSnapshot · AdminUser
- [x] **5b. Apify Actor 백엔드** — 샤오홍슈·TikTok/IG fallback · 트렌드 키워드 검색용
- [x] **5c. Admin UI** — 벤치마크 목록·상세·필터·태깅·임베딩 트리거·RAG 검색
- [x] **5d. viralFactors AI 태깅** — Claude Haiku 6축 구조 분해
- [x] **5e. Voyage AI 임베딩 + Copywriter RAG 모드** — pgvector 코사인 유사도 top-K few-shot

## Priority 6 — URL 인제스터 (Lane 1 · 하류 공통)

- [x] **6a. URL Ingester 프레임워크** — 텔레그램 봇 URL 자동 감지 · Adapter registry
- [x] **6b. Threads URL Adapter** — ~~HTML OG 파싱~~ → 🔴 OG 전멸, Apify 전환 코드 완료 (토큰 설정 대기)
- [x] **6c. 다국어·계정별 페르소나 Copywriter 확장** ★핵심 — 원본 언어 무관 · 페르소나로 완전 재창조
- [x] **6d. 계정별 페르소나 정의·관리 UI** — `/admin/personas` · 다국어 프리뷰
- [x] **6e. TikTok URL Adapter** — ~~oEmbed~~ → 🔴 HTTP 400 반환, 디버깅 or Apify 전환 필요
- [x] **6f. 샤오홍슈 URL Adapter** — Apify 필수, APIFY_API_TOKEN 미설정으로 미검증
- [x] **6g. Instagram URL Adapter** — ~~OG 파싱~~ → 🔴 OG 전멸, Apify 전환 코드 완료 (토큰 설정 대기)

## Priority 7 — 자율 트렌드 추적 (Lane 2)

### Stage 1 — 국내 트렌드 소스
- [x] **7a. TrendSignal 스키마 + 정규화 프레임워크**
- [x] **7b. 네이버 데이터랩 쇼핑인사이트 통합**
- [x] **7c. Google Trends 통합** — ~~google-trends-api 라이브러리~~ → ✅ RSS 직접 파싱으로 교체 완료
- [x] **7d. 트렌드 기반 플랫폼 콘텐츠 검색기** — 키워드 자동 번역 + Apify 검색
- [x] **7e. 자동 인제스션 큐 + 승인 대시보드** — BullMQ cron · Telegram 다이제스트

### Stage 2 — 플랫폼 자체 트렌드
- [x] **7f. TikTok Creative Center 트렌드 수집**
- [x] **7g. 쿠팡 랭킹 변동 감지** — Best category API · 8개 카테고리 poll

### Stage 3 — 시그널 정교화
- [x] **7h. 크로스플랫폼 상관관계 · 시그널 감쇠** — 자동 · poll 시마다

## Pipeline B — 팔로워 부스팅 (스하리)

- [x] **B1. 스하리 해시태그 벤치마크 수집기** (2026-09-01) — `pipeline-b/sharing-collector`
  - "스하리1000명프로젝트" Apify Threads 검색 · reply_count≥20 필터
  - contentType=SHARING 로 BenchmarkPost 저장 (쇼핑·일상 풀과 완전 분리)
  - 매일 09:00 KST 크론 (`sharing-collect-daily`)
  - 실측: 22 fetch → 10 통과 → 10 저장 완료
- [x] **B2. 스하리 글 각색 카피라이터** (2026-09-01) — SHARING 벤치마크 풀 replies 상위 few-shot 각색 · 계정 페르소나 무관 · 신상 노출 X
- [x] **B3. 스하리 발행 스케줄** (2026-09-01) — 계정별 1일 1건 · 매일 11:00 KST 크론 · 텔레그램 승인 카드 · 승인 후 기존 publisher 발행
- [ ] **B4. 팔로우백 액션** — 하드 캡 하루 3~5회, 4개 자체 계정 상호 금지 (별도 세션)

## 데이터 수집 재설계 (2026-08-31 실 검증 후 추가)

실 URL/API 검증 결과 5개 소스 고장 발견. 전략 v2 수립 완료.

- [x] **R1. Google Trends RSS 교체** — `google-trends-api` 제거, RSS 직접 파싱
- [x] **R2. Threads 어댑터 Apify 전환** — 코드 완료, APIFY_ACTOR_THREADS_URL 설정 시 활성화
- [x] **R3. Instagram 어댑터 Apify 전환** — 코드 완료, APIFY_ACTOR_IG_URL 설정 시 활성화
- [x] **R4. env.ts에 Apify actor env vars 추가** — THREADS_URL, IG_URL, TIKTOK_URL
- [ ] **R5. 텔레그램 /seed 텍스트 직접 입력** — Apify 없이 데이터 축적 가능한 최소 경로
- [ ] **R6. TikTok oEmbed 디버깅** — HTTP 400 원인 파악, 실패 시 Apify 전환
- [ ] **R7. 쿠팡 Search productPrice 매핑 수정** — 경미
- [ ] **R8. TikTok 어댑터 Apify 전환** — oEmbed 실패 시
- [ ] **R9. 전체 데이터 소스 실 동작 재검증** — Apify 토큰 발급 후

## Priority 8+ (나중)

- [ ] Pipeline B (스하리) 실 구현
- [ ] Pipeline C (일상글) 소스 방식 결정
- [ ] 웹 대시보드 (N ≥ 20)
- [ ] 주거용 프록시 (N ≥ 50)
- [ ] 계정 팜 프로세스

---

## 부가 완료 (2026-08-31 세션 후반)

**기술 스택 정리:**
- [x] Playwright 제거 (미사용)
- [x] Admin 인증 재구성: Basic Auth → DB backed → 로그인 페이지 + 세션 쿠키
- [x] AdminUser 스키마 + bcrypt 해싱
- [x] CLI: `pnpm admin:create` · `pnpm admin:list`
- [x] `.env.example` 정비 (Voyage · Naver · Apify · Session · 임계값)

**부트스트랩 보안:**
- [x] 부트스트랩 홀 봉쇄 — 웹으로 첫 admin 생성 불가
- [x] Admin 라우트 세션 검증 + GET은 /login 자동 리다이렉트
- [x] Cloudflare Access 가이드 문서화

**시스템 정리:**
- [x] dummy Threads 계정 자동 재생성 로직 제거 + purge 스크립트
- [x] InboundLink → BenchmarkPost 승격 파이프라인 (자동 + 수동)
- [x] Lane 1 수동 시딩은 무조건 승격 · Lane 2 자율은 임계값 검사

---

## 갱신 규칙

- **완료**: `[ ]` → `[x]` + 커밋에 포함
- **진행 중**: 부제로 "in progress"
- **블록됨**: 부제로 "blocked by X" 명시

## 사용자 액션 대기 목록

- ✅ Meta App Live 게시 · 5계정 OAuth 완료
- ✅ 모든 필수 credential 세팅
- (즉시 필요) `.env` VOYAGEAI_API_KEY → VOYAGE_API_KEY 이름 정정 + 채팅 노출된 키 재발급
- (선택) Apify 가입 · 샤오홍슈 액터 선정
- (선택) 네이버 개발자센터 API 신청
- (준비되면) 실 계정 발행 시작 (#4c)
