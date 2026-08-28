# Pinpoint-Threads Project Guide (for AI collaborators)

This file mirrors CLAUDE.md so that any AI collaborator (GPT, Gemini, Codex, etc.) can understand this project's rules.

## 🔴 세션 시작 시 필수 로드 (이 순서로)

새 세션 시작 시 다른 어떤 작업보다 먼저 이 4개를 순서대로 읽으세요. 그 후 사용자 지시 없이 다음 태스크가 뭔지 판단해서 이어갈 수 있습니다.

1. **`docs/STATE.md`** — 현재 상태 스냅샷
2. **`docs/TASKS.md`** — 21개 태스크 체크리스트
3. **`docs/session-log/`** 최신 파일 — 이전 세션 인수인계
4. `git log --oneline -20` — 최근 커밋

## 작업 중 문서 참조

- `docs/INDEX.md` — 전체 문서 카탈로그
- 각 문서의 `related:` 프론트매터를 따라 필요한 것만 로드

## 세션 종료 시 (또는 커밋 시) 갱신

- `docs/STATE.md` — 상태 변화 있을 때마다
- `docs/TASKS.md` — 태스크 체크박스 업데이트
- `docs/session-log/YYYY-MM-DD.md` — 세션 인수인계 파일 작성/갱신

## Hard Rules

- 본문에 쿠팡/무신사 링크 절대 금지 (고정 댓글 또는 프로필로만)
- 계정 간 최소 1~4h 랜덤 시차, 동시 발행 금지
- 스하리 팔로우백 하루 3~5회 하드 캡
- 공정위 필수 문구 대댓글에 반드시 포함
- 4개 자체 계정끼리 팔로우/스하리/맞팔 절대 금지
- 미디어는 쇼핑·일상글에서 반드시 2개 이상
- 상품 중복 노출: 계정별 14일 이내 동일 상품 금지

## Architecture Snapshot

- 3 pipelines: A (shopping/monetization), B (suhari/growth), C (daily/engagement)
- 12 runtime modules cataloged in `docs/09-agents/catalog.md`
- Stack: TypeScript / Node.js / Fastify / BullMQ / Prisma / Neon Postgres / grammY / Anthropic Claude
- Copy strategy: static prompt at launch → auto-switch to RAG when benchmark data threshold met
