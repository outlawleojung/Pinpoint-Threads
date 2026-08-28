# Pinpoint-Threads Project Guide (for AI collaborators)

This file mirrors CLAUDE.md so that any AI collaborator (GPT, Gemini, Codex, etc.) can understand this project's rules.

## 반드시 먼저 읽을 것

1. `docs/INDEX.md` — 전체 문서 카탈로그
2. 관련 문서의 `related:` 프론트매터를 따라 필요한 것만 로드

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
