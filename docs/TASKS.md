# Tasks — 영구 진행 상황

**이 파일은 Task tool의 세션-스코프 상태를 대체합니다.** 새 세션 시작 시 여기서 상태를 확인하고, 완료 시 체크박스를 업데이트.

Last synced: 2026-09-02 (Pipeline A 자동 발행 · 성별 필터 · 비디오 지원 · 트렌드 재설계 반영)

**진행률: 49/49 초기 태스크 + 신규 B1~B4·#46~49 완료 · 데이터 수집 v2 완료**

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
- [x] **3c. Content Classifier 실 테스트** — audience 축 추가 (2026-09-02)
- [x] **3d. Copywriter 카피 품질 검증**
- [x] **3e. Product Matcher 통합**
- [x] **3f. Media Handler** — Cloudinary uploadFromUrl / uploadManyFromUrls · video/upload 지원 (2026-09-02)
- [x] **3g. Reply Composer** — AI 감초 톤
- [x] **3h. Pipeline A e2e 검증** — `/pa` 통과

## Priority 4 — 발행 파이프라인

- [x] **4a. Threads OAuth 흐름** — 5계정 실 연결, `/oauth/threads/accounts` UI
- [x] **4b. Publisher** — 2-step + carousel + 고정 댓글 + refresh 자동화 · 비디오 reply 후 15초 대기 + 재시도 4회 (2026-09-02)
- [x] **4c. 실 계정 1개 발행 e2e** — @kle0_lee 발행 완료 (threadsPostId 18104792209954978, 2026-09-01)
- [x] **4d. 계정 시차 스케줄링** — BullMQ delayed · 활성 시간대 · 일일 상한
- [x] **4e. Performance Collector** — 24h/72h insights 자동 회수 · engagementScore

## Priority 5 — Source Collector · 벤치마크 (저)

- [x] **5a. Prisma 스키마** — SeedSource · BenchmarkPost · InboundLink · TrendSignal · PostInsightSnapshot · AdminUser
- [x] **5b. Apify Actor 백엔드** — 샤오홍슈·TikTok/IG fallback · 트렌드 키워드 검색용
- [x] **5c. Admin UI** — 벤치마크 목록·상세·필터·태깅·임베딩 트리거·RAG 검색
- [x] **5d. viralFactors AI 태깅** — Claude Haiku 7축 (audience 추가) 구조 분해
- [x] **5e. Voyage AI 임베딩 + Copywriter RAG 모드** — pgvector 코사인 유사도 top-K few-shot

## Priority 6 — URL 인제스터 (Lane 1 · 하류 공통)

- [x] **6a. URL Ingester 프레임워크** — 텔레그램 봇 URL 자동 감지 · Adapter registry
- [x] **6b. Threads URL Adapter** — Apify themineworks · 실 e2e (2026-08-31)
- [x] **6c. 다국어·계정별 페르소나 Copywriter 확장** ★핵심 — 원본 언어 무관 · 페르소나로 완전 재창조
- [x] **6d. 계정별 페르소나 정의·관리 UI** — `/admin/personas` · 다국어 프리뷰
- [x] **6e. TikTok URL Adapter** — Apify clockworks · 실 e2e (2026-08-31 커밋 0a26ff4)
- [x] **6f. 샤오홍슈 URL Adapter** — Apify zen-studio · 텔레그램 수동 URL 전용
- [x] **6g. Instagram URL Adapter** — Apify apify/instagram-post-scraper · 실 e2e

## Priority 7 — 자율 트렌드 추적 (Lane 2)

### Stage 1 — 국내 트렌드 소스
- [x] **7a. TrendSignal 스키마 + 정규화 프레임워크**
- [x] **7b. 네이버 데이터랩** — NAVER Cloud Platform 마이그레이션 · 신용카드 필요로 skip
- [x] **7c. Google Trends 통합** — RSS 직접 파싱으로 교체
- [x] **7d. 트렌드 기반 플랫폼 콘텐츠 검색기** — 키워드 자동 번역 + Apify 검색
- [x] **7e. 자동 인제스션 큐 + 승인 대시보드** — BullMQ cron · Telegram 다이제스트

### Stage 2 — 플랫폼 자체 트렌드
- [x] **7f. TikTok Creative Center 트렌드 수집**
- [x] **7g. 쿠팡 랭킹 변동 감지** — Best category API · **패션·뷰티 3개 카테고리로 좁힘** (2026-09-02)

### Stage 3 — 시그널 정교화
- [x] **7h. 크로스플랫폼 상관관계 · 시그널 감쇠** — 자동 · poll 시마다

### Stage 4 — 필터·재설계 (2026-09-02)
- [x] **7i. 트렌드 LLM 필터 (filterAndGeneralize)** — 정치·인물·긴 상품명 drop · 페르소나 매칭
- [x] **7j. 트렌드 수집 패션·뷰티 재설계** — 주방·간편식·건강식품·인테리어 기본템 drop

## Pipeline B — 팔로워 부스팅 (스하리)

- [x] **B1. 스하리 해시태그 벤치마크 수집기** (2026-09-01)
  - "스하리1000명프로젝트" Apify Threads 검색 · reply_count≥20 필터
  - contentType=SHARING 로 BenchmarkPost 저장 (쇼핑·일상 풀 분리)
  - 매일 08:00 KST 크론 (`sharing-collect-daily`)
- [x] **B2. 스하리 글 각색 카피라이터** (2026-09-01) — RAG · 훅 유형별 다양화 · 신상 노출 X · 계정 나이/팔로워 컨텍스트 반영
- [x] **B3. 스하리 발행 스케줄** (2026-09-01) — 매일 09:00 KST · 텔레그램 승인 카드 → 사용자 승인 후 발행
- [ ] **B4. 팔로우백 액션** — 하드 캡 하루 3~5회, 4개 자체 계정 상호 금지 (별도 세션)
- [x] **B5. 계정 컨텍스트 (팔로워+나이) 매일 동기화** (2026-09-02) — 07:30 KST · Threads API 팔로워 수 · 오래된 게시글 timestamp

## 최근 신규 (2026-09-02)

- [x] **#46 Pipeline A 하이브리드 상품 매칭** — 텔레그램에 벤치마크 URL + Coupang URL 함께 전송 시 자동 페어링 · Product Matcher/Vision 스킵 · Deeplink API 로 파트너스 링크 변환
- [x] **#47 Threads 비디오 지원** — Playwright headless (로그인 X · 계정 무관) · mp4 URL 추출 · Cloudinary /video/upload · Threads VIDEO container · Telegram sendMediaGroup video type
- [x] **#48 쇼핑 자동 발행 스케줄** — 매일 09:00 KST 카피 생성 · 계정별 시차 slot (10:00/17:00, 11:30/18:30, 13:00/20:00, 14:30/21:30, 16:00/22:30) · publishQueue delay · 승인 카드 스킵 (완전 자동)
- [x] **#49 계정↔상품 성별 매칭 필터** — Account.audienceGender (male/female/unisex) · viralFactors.audience 태그 · 성별 충돌 시 skip

## 데이터 수집 재설계 (2026-08-31 실 검증 후 추가)

- [x] **R1. Google Trends RSS 교체** — `google-trends-api` 제거, RSS 직접 파싱
- [x] **R2. Threads 어댑터 Apify 전환** — themineworks 통합 · 실 e2e
- [x] **R3. Instagram 어댑터 Apify 전환** — apify/instagram-post-scraper 통합
- [x] **R4. env.ts에 Apify actor env vars 추가** — THREADS_URL, IG_URL, TIKTOK_URL, THREADS_KEYWORD
- [ ] **R5. 텔레그램 /seed 텍스트 직접 입력** — 우선순위 낮음 (Apify 로 대체됨)
- [x] **R6. TikTok Apify 전환** (커밋 0a26ff4) — clockworks/tiktok-video-scraper
- [ ] **R7. 쿠팡 Search productPrice 매핑 수정** — 경미 (뒤로)
- [x] **R8. TikTok 어댑터 Apify 전환** — R6과 동일 커밋에서 완료
- [ ] **R9. 전체 데이터 소스 실 동작 재검증** — 부분 완료 (Threads·TikTok·IG·XHS 각각 실 테스트 완료)

## 보류 (Backlog)

- 이미지 교체 기능 · 네이버쇼핑 링크 지원 → [docs/09-backlog/image-replacement-and-naver.md](09-backlog/image-replacement-and-naver.md)
- Pipeline C (일상글) — 소스 방식 결정 후 착수
- 강의 학습 이식 (Whisper 전사 · 프롬프트 룰 이식) — 사용자님 녹화 대기
- 웹 대시보드 강화 (N ≥ 20)
- 주거용 프록시 · 계정 팜 프로세스 (Phase 4+)
- Meta oEmbed 앱 심사 신청 (링크 프리뷰 카드 억제 목적)

---

## 갱신 규칙

- **완료**: `[ ]` → `[x]` + 커밋에 포함
- **진행 중**: 부제로 "in progress"
- **블록됨**: 부제로 "blocked by X" 명시

## 사용자 액션 대기 목록

- ✅ Meta App Live 게시 · 5계정 OAuth 완료
- ✅ 모든 필수 credential 세팅
- (선택) Apify 가입 · 샤오홍슈 액터 선정
- (선택) 네이버 개발자센터 API 신청
- ✅ 실 계정 발행 시작 (#4c 완료)
- (Phase 4) 클라우드 배포 (NCloud or 대안 · 사용자 결제 하드캡 이슈로 결정 보류)
