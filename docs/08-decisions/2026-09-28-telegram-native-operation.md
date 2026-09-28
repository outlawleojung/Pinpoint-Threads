---
title: 텔레그램 네이티브 운영 (발굴→발행→분석 전부 텔레그램에서)
status: accepted
date: 2026-09-28
related:
  - src/modules/shared/approval-gate/bot.ts
  - src/modules/shared/url-ingester/index.ts
  - src/modules/shared/source-collector/types.ts
  - docs/00-overview/revenue-playbook.md
---

# 텔레그램 네이티브 운영

## 문제

지금 일일 운영이 **Claude Code 채팅 창에 묶여 있다.** 사용자가 소재 URL을 이 채팅에 붙이면 Claude가 스크립트를 돌려 카드를 만든다. Claude 세션이 없으면 아무것도 안 돌아간다.

목표: **발굴 → 발행 → 정정 → 분석까지 전부 텔레그램 안에서.** 이 채팅은 개발/설계용으로만.

## 현재 상태 (이미 텔레그램에서 되는 것)

`bot.ts` 확인 결과 운영의 대부분은 이미 텔레그램에서 됨:

- URL 붙여넣기 → 자동 인제스트
- `일상 {URL} | 설명` → Pipeline C 일상글 카드
- `발행 {URL} | 방향 | 쿠팡링크` → 커스텀 쇼핑 카드
- `{URL} 상품명` → 쇼핑 매칭 카드
- 카드에 **답장**으로 정정 → 즉시 재생성
- 버튼으로 승인/리젝
- `/published` 계정별 발행·성과 현황

**진짜 빠진 것: 발굴(discovery).** 후보 URL을 찾아주는 단계만 아직 Claude 채팅에 남아 있음.

## 제약 (설계 결정 요인)

1. **정서**: 소스는 서구(Reddit)가 아니라 정서 가까운 **동아시아·동남아**(일본·중국·동남아) 감성이어야 반응이 옴. → [project_source_foreign_viral_only]
2. **재현 가능 플랫폼**: 후보를 재생산하려면 인제스터가 지원하는 플랫폼이어야 함. 현재 Threads·TikTok·샤오홍슈·Instagram만 지원. **X(트위터) 미지원.**
3. **최고의 검증된 소스(일본 동물)가 X에 있음** → X 인제스트 지원을 추가한다(사용자 결정: X + TikTok 둘 다).
4. **비용**: 자동 LLM 금지. 발굴 수집·필터는 규칙 기반. → [feedback_conserve_api_cost]

## 설계

### A. X(트위터) 인제스트 지원

- `InboundPlatform`에 `X` 추가(마이그레이션).
- `platform-detector`: `x.com` / `twitter.com` / `t.co` 감지.
- **X 어댑터 = 트위터 syndication JSON**(`cdn.syndication.twimg.com/tweet-result`) — 임베드용 공개 엔드포인트. 텍스트·이미지·mp4 variant를 한 번에 반환. Playwright 불필요(비용·안정성 우위).
- `adapters/registry.ts`에 X 어댑터 등록.

### B. 발굴 모듈 `src/modules/shared/discovery/`

기존 `SourceAdapter` 인터페이스 재사용. 어댑터 = 정서 맞는 해외 바이럴 후보 수집.

- `types.ts` — `DiscoveryCandidate { id, platform, sourceUrl, title, thumbnailUrl?, authorHandle?, lang, kindHint('daily'|'shopping'), score?, foundAt }`
- `filters.ts` — 정치·사건사고·슬픔/죽음 제외 정규식(공용). 미디어 없는 후보 제외.
- `adapters/jp-animal-x.ts` (**검증됨 · 주력**) — 일본 동물 일일-갱신 모음(buzzweet 등)에서 X status URL 추출 → 각 URL을 syndication으로 enrich(텍스트·미디어·썸네일·언어) → 필터 → 후보.
- `adapters/tiktok-trend.ts` (**베스트에포트 · 실험적**) — 일본·중국·동남아 TikTok 트렌딩. 안정 소스 확보 전까지 빈 배열 가능(로그로 degraded 표시). 실패해도 jp-animal-x는 독립 동작.
- `index.ts` — `discoverCandidates({ limit })`: 활성 어댑터 실행 → InboundLink 대조로 **이미 다룬 URL 제외**(재탕 방지) → 필터 → 상위 K. 결과를 **Redis에 짧은 id로 저장**(콜백 조회용, TTL 24h). DB 마이그레이션 불필요.

### C. 텔레그램 명령

- **`/소재`** (별칭 `/discover`): `discoverCandidates` 실행 → 후보를 하나씩 메시지로(썸네일 있으면 사진 첨부) + 인라인 버튼:
  - `[🌿 일상글]` → `disc:daily:<id>` → 기존 `runDailyFromUrl` 흐름 → 승인 카드
  - `[⏭ 스킵]` → `disc:skip:<id>`
- 콜백 핸들러 `disc:...`: Redis에서 후보 조회 → 해당 파이프라인 실행. **발굴~발행 전부 텔레그램 안에서 완결.**
- **`/help`** 재작성: 흩어진 명령을 운영 흐름 순으로 정리(발굴 → 발행 → 정정 → 현황).

### D. (Phase 2, 후속) 운영 대시보드·분석

- `/오늘` — 계정별 오늘 일상/스하리/쇼핑 카운트 vs 목표(일상·스하리 매일 1, 쇼핑 간간히) + 대기 카드 + 원탭 채우기.
- `/분석` — 2일 전 발행분 KPI(조회수, 댓글조회/조회≥10%) 자동 분석. → [project_performance_kpi]

## 빌드 순서

- **Phase 1 (지금)**: A(X 인제스트) + B(발굴 모듈 + jp-animal-x + tiktok best-effort) + C(`/소재` + 콜백 + `/help`). → "채팅 창에 URL 붙이는 일" 종료.
- **Phase 2 (후속)**: D(`/오늘`, `/분석`).

## 리스크

- 아그리게이터/트렌딩 소스는 스크래핑 특성상 셀렉터·차단으로 깨질 수 있음. 어댑터별 독립 실패 격리 + degraded 로그. 소스 좁게 시작 후 확장.
- syndication 엔드포인트는 비공식(임베드용 공개). 스키마 변동 가능 → 방어적 파싱.
