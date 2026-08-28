# Tasks — 영구 진행 상황

**이 파일은 Task tool의 세션-스코프 상태를 대체합니다.** 새 세션 시작 시 여기서 상태를 확인하고, 완료 시 체크박스를 업데이트.

Last synced: 2026-08-28

## Priority 1 — 외부 세팅 (사용자 + 저)

- [x] **1a. Meta App 등록 & Threads API 신청** — 앱 등록·권한 7개·5 테스터 완료. **⚠️ 노출된 앱 시크릿 재발급 필요**
- [x] **1b. Neon Postgres 프로젝트 생성** — ap-southeast-1, pgvector 0.8.6
- [x] **1c. Cloudinary 계정 & API Key** — Cloud name `xwqbwrs1`, API Secret 사용자 .env 입력 대기
- [ ] **1d. Apify Threads Actor 무료 시험** — 사용자님 몫, 10분. Source Collector 설계 근거 확보용
- [x] **1e. 5개 Threads 계정 상태 점검** — 모두 테스터 수락 완료

## Priority 2 — 기반 인프라 (저)

- [x] **2a. 로컬 Postgres → Neon 이관** — DATABASE_URL Neon, docker-compose Redis만 유지
- [x] **2b. pgvector 활성화** — 확장 설치, 마이그레이션 적용
- [x] **2d. src 12-module 재구조화** — infra/ + modules/{shared, pipeline-a, pipeline-b}

## Priority 3 — Pipeline A 실 구현 (저)

- [x] **3a. Coupang HMAC + Search + Deeplink** — 실 API 통신 검증. `/coupang` `/deeplink` 명령
- [x] **3b. Vision Verifier 실 테스트** — `/vision` 통과 (Anthropic Sonnet, base64 인라인 방식)
- [x] **3c. Content Classifier 실 테스트** — `/classify` 검증 완료
- [x] **3d. Copywriter 카피 품질 검증** — `/copy 1~4` 4양식 실전 검증. thinking mode 끄기 튜닝
- [x] **3e. Product Matcher 통합** — `/matcher` 실 검증 통과 (score 0.75, 1회 시도, deeplink 생성 완료)
- [x] **3f. Media Handler** — Cloudinary uploadFromUrl / uploadManyFromUrls / 2개 이상 검증
- [x] **3g. Reply Composer** — 재설계: 4양식 폐기, AI 감초 톤 매번 생성 (Anthropic Sonnet). 상품·본문 맥락 기반 자연스러운 리드 문장
- [x] **3h. Pipeline A e2e 검증** — `/pa` 통과. 소스 미디어 2개 → 분류 → 매칭 → Cloudinary → 카피 → AI 감초 댓글 → 승인 카드 (미디어 그룹 프리뷰)

## Priority 4 — 발행 파이프라인 (Meta 승인 후)

- [ ] **4a. Threads OAuth 흐름** — 5개 계정 Long-lived token 발급, DB Account 저장
- [ ] **4b. Publisher** — 2-step 발행 + 고정 댓글. 자동 링크 프리뷰 억제 검증
- [ ] **4c. 실 계정 1개 발행 e2e**
- [ ] **4d. 계정 시차 스케줄링** — BullMQ delayed job, 1~4h 랜덤
- [ ] **4e. Performance Collector** — 24h/72h insights 회수, engagementScore 계산

## Priority 5+ (나중)

- [ ] Pipeline B (스하리) 실 구현
- [ ] Pipeline C (일상글) 소스 방식 결정
- [ ] Voyage AI + RAG 자동 전환
- [ ] 웹 대시보드 (N ≥ 20)
- [ ] 주거용 프록시 (N ≥ 50)
- [ ] 계정 팜 프로세스

---

## 갱신 규칙

- **완료**: `[ ]` → `[x]` 로 변경 + 커밋에 포함
- **진행 중**: 부제로 "in progress" 언급 or 상세 노트 추가
- **블록됨**: 부제로 "blocked by X" 명시
- 매 커밋 시 관련 항목만 업데이트

## 사용자 액션 대기 목록

- ✅ Meta App Secret 재발급 & .env 반영 (완료)
- ✅ Cloudinary API Secret .env 입력 (완료)
- ✅ Coupang Access Key / Secret .env 입력 (완료)
- ✅ Anthropic API 크레딧 충전 & 키 발급 (완료)
- (선택) Apify 계정 & Threads Actor 시험 — Source Collector 설계 근거용
- Meta App 심사 진행 상황 확인 필요 (Threads API 승인 대기)
