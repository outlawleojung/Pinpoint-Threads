# Pinpoint-Threads

Threads 커머스·엔게이지먼트 자동화 파이프라인.

## 이 문서

이 파일은 최소 정체성만 담습니다. 상세 규칙과 설계는 `docs/`에.

## 🔴 세션 시작 시 필수 로드 (반드시 이 순서로)

**새 대화 시작 시 다른 어떤 작업보다 먼저 이 4개를 순서대로 읽으세요.** 그 후 사용자 지시 없이도 다음 태스크가 뭔지 스스로 판단해서 이어갈 수 있습니다.

1. **`docs/STATE.md`** — 지금 프로젝트 상태 스냅샷 (Phase, 완료된 것, 진행 중, credential 상태, 서비스 상태)
2. **`docs/TASKS.md`** — 21개 태스크 체크리스트 (Task tool 대체, 완료·미완료·사용자 액션 대기)
3. **`docs/session-log/`** 최신 파일 (파일명 = 날짜) — 이전 세션 인수인계
4. **최근 git log 20개** — `git log --oneline -20` — 최근 커밋 컨텍스트

## 작업 중 문서 참조

**어떤 작업이든 시작 전에 반드시:**
1. `docs/INDEX.md` 를 열어 관련 문서를 찾는다.
2. 해당 문서와 그 문서의 `related:` 프론트매터에 명시된 파일들을 로드한다.

## 세션 종료 시 (또는 커밋 시) 갱신 규칙

- **`docs/STATE.md`** — 상태 변화 있을 때마다 갱신 (특히 완료된 컴포넌트, credential 변경)
- **`docs/TASKS.md`** — 태스크 상태 바뀔 때 체크박스 업데이트
- **`docs/session-log/YYYY-MM-DD.md`** — 세션 종료 시 인수인계 파일 작성/갱신

## 최소 규칙 (읽지 않고 위반하면 안 됨)

- 본문에 쿠팡/무신사 링크 절대 금지 (고정 댓글 또는 프로필로만)
- 계정 간 최소 1~4h 랜덤 시차, 동시 발행 금지
- 스하리 팔로우백 하루 3~5회 하드 캡, 초과 시 즉시 셧다운
- 공정위 필수 문구 대댓글에 반드시 포함
- 4개 자체 계정끼리 팔로우/스하리/맞팔 절대 금지
- 미디어는 쇼핑·일상글에서 반드시 2개 이상
- 상품 중복 노출: 계정별 14일 이내 동일 상품 금지

## 프로젝트 개관

- 3개 파이프라인: A(쇼핑·수익화), B(스하리·팔로워부스팅), C(일상글·엔게이지먼트)
- 12개 런타임 모듈: [docs/09-agents/catalog.md](docs/09-agents/catalog.md)
- 스택: TypeScript / Node.js / Fastify / BullMQ / Prisma / Neon Postgres / grammY / Anthropic Claude
- 인프라: 로컬 개발 → Phase 4 Hetzner VPS 이전
- 카피 전략: 정적 프롬프트 launch → 데이터 임계량 도달 후 RAG 자동 전환

## 프로젝트 상태

- Phase: 2 (API 어댑터 구현 중)
- Meta Threads API 승인: 대기 중
- 파이프라인 진행률: A(설계 확정), B(설계), C(설계)

## 커스텀 서브에이전트

프로젝트 전용 도메인 전문가는 `.claude/agents/`에:
- `threads-api-expert`, `commerce-partners-expert`, `prompt-engineer`, `playwright-scraper-expert`, `safety-auditor-dev`
