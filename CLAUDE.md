# Threads Commerce & Engagement Automation Pipeline

## 1. Project Overview
본 프로젝트는 일본/중국 등 해외 소셜 미디어(Threads, X 등)에서 검증된 고반응 소비재/생활 꿀템 콘텐츠를 수집·가공하여, 국내 쓰레드(Threads) 계정 4~5개에 최적화된 톤으로 자동 발행하고 쿠팡 파트너스 수익을 창출하는 AI 기반 자동화 파이프라인이다.
안전성을 위해 최종 포스팅 직전 Telegram Bot을 통한 1-Click 승인(Human-in-the-loop) 구조를 유지하며, 계정 지수 부스팅을 위한 '스하리(품앗이)' 안전 워커를 포함한다.

---

## 2. Core Architecture & Pipeline Flow

### Pipeline A: Commerce Post Pipeline (쇼핑 큐레이션)
1. **Source Collection:** 해외 트렌드 포스팅의 원문 텍스트 + 미디어(이미지/영상) URL 스크래핑/수집
2. **AI Classification & Extraction (LLM + Vision):**
   - 일반 소비재/생활용품 적합성 필터링 (부적합 시 DROP)
   - 원본 미디어 및 텍스트 기반 '쿠팡 검색용 표준 단일 키워드' 추출
3. **Product Matching & Link Generation:**
   - 쿠팡 파트너스 Open API 상품 검색 (로켓배송, 평점 4.5 이상 최상위 상품)
   - Vision AI 기반 원본 이미지 vs 쿠팡 상품 썸네일 정합성 검증 (Self-Correction Loop: 불일치 시 키워드 수정 재검색)
   - 쿠팡 파트너스 딥링크(단축 URL) 자동 생성
4. **Persona-based Copywriting:**
   - 타깃 계정 성향에 맞춘 쓰레드 구어체 본문 생성 (첫 줄 후킹, 줄바꿈 호흡, 이모지 절제)
   - 대댓글 텍스트 생성 ("정보 물어보시는 분들 많아서 링크 남겨요" + 쿠팡 딥링크 + 공정위 필수 문구)
5. **Human-in-the-loop (Telegram Bot):**
   - 텔레그램 인라인 키보드 발송: 미디어 미리보기 + 본문/댓글 + 상품명/링크
   - 버튼: `[발행 승인]`, `[텍스트 재생성]`, `[상품 재검색]`, `[폐기]`
6. **Publishing (Threads Graph API):**
   - `[발행 승인]` 수신 시 2-Step 순차 포스팅:
     - Step 1: 본문 텍스트 + 미디어 포스팅 (`POST /me/threads`)
     - Step 2: 생성된 `thread_id` 하위에 쿠팡 링크 대댓글 즉시 등록 (상단 고정 효과)

### Pipeline B: Engagement Safety Worker (스하리 루틴)
1. **Daily Post (1일 1회):**
   - 오전 08:00~08:30경 일상 공감 + 스하리 유도 포스팅 1회 자동 발행
2. **Auto-Reciprocation Worker (맞스하리 안전 워커):**
   - 내 스하리 포스팅에 달린 댓글 감지
   - **Hard Rule:** 1일 계정당 최대 3회까지만 처리 (`DAILY_LIMIT = 3`)
   - **Safety Interval:** 10분~30분의 무작위 딜레이(Random Jitter) 후 대상 유저 최신 글 하트/리포스트 + 대댓글 작성
   - 3회 초과 시 당일 워커 즉시 셧다운 (봇 감지/계정 정지 원천 차단)

---

## 3. Tech Stack & Infrastructure (확정)

- **Language & Runtime:** TypeScript + Node.js 20+
- **HTTP Framework:** Fastify (Telegram/Meta webhook 수신용)
- **Task Queue / Scheduler:** BullMQ + Redis (지연 잡, 반복 잡, rate limit)
- **Database:** PostgreSQL + Prisma ORM
- **Telegram Bot:** grammY (인라인 키보드 콜백)
- **Source Scraping:** Playwright (쓰레드 공식 API가 타 계정 조회 미지원)
- **Media Hosting:** Cloudflare R2 (Threads API 요구 공개 URL 제공)
- **Deployment:** Docker Compose (app + worker + redis + postgres)
- **Infrastructure Phase:** Phase 1 로컬(Windows + Docker Desktop) → 수익 검증 후 VPS/클라우드 이전
- **External APIs:**
  - Anthropic API (Claude Sonnet: Vision/카피, Haiku: 필터링)
  - Coupang Partners Open API (HMAC-SHA256, Search, Deeplink) — **승인 완료**
  - Musinsa Curator API (패션/의류 카테고리) — **승인 완료**
  - Meta Threads Graph API (Container Media Post, Reply by parent_id) — **승인 대기 필요**
  - Telegram Bot API (grammY, Inline Keyboard)

### Commerce Channel Routing
- AI 분류 노드가 카테고리 판정 후 채널 라우팅:
  - **의류 / 신발 / 패션잡화 / 뷰티** → 무신사 큐레이터 우선, 미매칭 시 쿠팡 폴백
  - **생활용품 / 가전 / 식품 / 기타** → 쿠팡 파트너스
- 어댑터는 공통 인터페이스(`CommerceAdapter.search()`, `.generateDeeplink()`)로 추상화하여 채널 확장 용이하게 설계

---

## 4. Key Rules & Guardrails for AI Agent

1. **Deterministic Pipeline First:**
   - 전체 파이프라인 프레임은 무거운 자율 에이전트 프레임워크 대신 견고한 백엔드 상태 머신(State Machine)으로 구축한다.
   - AI는 '필터링 판정', 'Vision 상품 일치 검증', '카피라이팅' 노드에 격리하여 호출한다.
2. **Account Safety Top Priority (CIB 방지):**
   - 본문에 쿠팡/무신사 링크 절대 삽입 금지 (반드시 대댓글 또는 프로필로 분리).
   - **계정별 페르소나 완전 분리:** 각 `Account.persona_prompt`에 말투·이모지 사용량·줄바꿈 스타일·활동 시간대를 독립 지정. 같은 소스라도 계정별 재작성 시 `accountId`를 seed로 사용해 표현 다변화 강제.
   - **타이밍 다변화:** 다계정 동시 발행 금지. 계정 간 최소 **1~4시간 랜덤 지연** (BullMQ delayed job). 계정마다 사전 지정된 활동 시간대 안에서만 발행.
   - **상품 반복 노출 금지:** `(account_id, product_id)` 최근 14일 이내 중복 발행 금지 (DB 유니크 제약 + 조회 필터).
   - **계정 상호 격리:** 4개 자체 계정끼리 팔로우/스하리/맞팔 절대 금지. 스하리 대상은 반드시 외부 사용자.
   - **네트워크 격리 (로컬 단계 완화 규칙):** 요청 헤더/User-Agent를 계정별 상이하게 지정. 클라우드 이전 시 계정별 주거용 프록시 분리 의무화.
   - **맞스하리 하드 캡:** 하루 계정당 최대 3회 (`DAILY_LIMIT = 3`), 10~30분 랜덤 지터, 초과 시 즉시 셧다운.
3. **Legal Compliance:**
   - 쿠팡 파트너스 대댓글에는 반드시 필수 법적 문구 표기:
     *"이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."*

---

## 5. Implementation Milestones

- [ ] **Phase 0 (Day 0):** External Dependencies
  - [ ] Meta for Developers 앱 등록 + Threads API 권한 신청 (`threads_basic`, `threads_content_publish`, `threads_manage_replies`)
  - [ ] 4개 계정 테스터 등록 + Long-lived Access Token 발급
  - [ ] Telegram Bot 생성 (@BotFather)
  - [ ] Cloudflare R2 버킷 생성
- [ ] **Phase 1 (Week 1):** Foundation
  - [ ] Docker Compose (Postgres + Redis) 로컬 기동
  - [ ] Prisma 스키마 (`Post`, `Account`, `EngagementLog`, `SourceItem`, `CommerceProduct`)
  - [ ] BullMQ 큐 정의 (`collect`, `classify`, `match-product`, `copywrite`, `approve`, `publish`, `engagement`)
  - [ ] State Machine 스켈레톤
- [ ] **Phase 2 (Week 2):** API Adapters
  - [ ] Telegram Bot 어댑터 (grammY, 인라인 키보드 4버튼)
  - [ ] Coupang Partners 어댑터 (HMAC, Search, Deeplink)
  - [ ] Musinsa Curator 어댑터 (공통 CommerceAdapter 인터페이스)
  - [ ] Anthropic 어댑터 (분류/카피/Vision 3함수 분리)
  - [ ] Threads Graph API 어댑터 (2-step Container Publish + Reply)
  - [ ] R2 미디어 업로드 유틸
- [ ] **Phase 3 (Week 3):** Pipeline A — 승인까지 수직 통합
  - [ ] 수동 URL 입력 → 승인 프리뷰 e2e 1건 성공
  - [ ] Vision 정합성 Self-Correction Loop (최대 3회)
  - [ ] 채널 라우팅 (패션→무신사 / 그 외→쿠팡, 폴백 포함)
- [ ] **Phase 4 (Week 4):** Publishing & Multi-account
  - [ ] 2-Step 순차 포스팅 (본문 + 대댓글 링크)
  - [ ] 계정별 15~30분 시차 지연 큐 (BullMQ delayed job)
  - [ ] 토큰 만료·rate limit 재시도 전략
  - [ ] 상태 조회 관리 페이지 (Fastify + 간단 UI)
- [ ] **Phase 5 (Week 5):** Pipeline B — 스하리 안전 워커
  - [ ] 일 1회 스하리 유도 포스팅 (cron)
  - [ ] 댓글 폴링 → 대상 유저 수집
  - [ ] 하드 리밋 카운터 (`DAILY_LIMIT=3`) 우선 배치
  - [ ] Random Jitter (10~30분) + 카운터 초과 시 셧다운 알림
- [ ] **Phase 6 (Week 6+):** 자동 수집 & 스케일링
  - [ ] Playwright 기반 쓰레드 트렌드 스크래퍼 (해외 + 한국 계정)
  - [ ] Dedupe (URL 해시 + 임베딩 유사도)
  - [ ] 소스별 성과 트래킹 대시보드
  - [ ] 수익 검증 후 VPS 이전
