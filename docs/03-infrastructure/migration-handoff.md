---
title: "서버 이전 · 새 Claude 계정 인수인계 (2026-10-21)"
status: active
related: [docs/08-decisions/ops-runbook.md, docs/STATE.md, docs/memory/MEMORY.md, docs/03-infrastructure/deployment.md, docker-compose.yml]
---

# 서버 이전 · 새 Claude 계정 인수인계

사용자가 2026-10-23 퇴사 → 지금 PC(D:\Source Code\thread_project)의 서버와 이 Claude Code 계정을 더 쓸 수 없음.
**새 위치 = Google Cloud e2-micro 무료(2026-10-23 결정).** 사용자 Google AI Pro 구독에 GCP 크레딧 월 $10 포함(개발자 프로그램 혜택 1회 활성화 필요) → 부대비용 충당. 카드는 기존 구글 결제 프로필. Oracle 무료는 사용자가 카드 신규 등록 거부로 보류. 램 부족하면 e2-small(서울 ~$15, 차액 자부담)로 상향 — 스크립트 동일. 서비스 계정(GitHub·Neon·Cloudinary·Anthropic·Meta 앱·텔레그램 봇·쿠팡)은 **전부 개인 계정** → 그대로 이어 씀.

## 1. 무엇이 어디에 있나
| 항목 | 위치 | 이전 작업 |
|---|---|---|
| 코드·문서·학습 기록 | GitHub `outlawleojung/Pinpoint-Threads` (브랜치 `feature/naver-cta-button`) | clone 만 하면 됨 |
| DB (글·계정·토큰·소재 감시 목록·벤치마크) | Neon 클라우드 | **없음** — 같은 `DATABASE_URL` 사용 |
| 미디어·스하리 보관함 | Cloudinary 클라우드 | 없음 |
| 비밀키 `.env` | **이 PC 에만 있음 · git 에 없음** | **사용자가 직접 개인 저장소(비밀번호 관리자·USB)로 복사** ← 가장 중요 |
| 큐(BullMQ) | 로컬 Redis(docker) | 옮기지 않음 — 승인된 예약은 DB 에 있고 `reschedule-approved` 로 다시 큐에 넣음 |
| Claude 메모리 | `~/.claude/projects/.../memory/` | 사본이 `docs/memory/` 에 있음 |

`.env` 키 목록(값은 여기 적지 않음): DATABASE_URL · REDIS_* · ANTHROPIC_* · GEMINI_API_KEY · META_APP_ID/SECRET/REDIRECT_URI · COUPANG_* · MUSINSA_* · TELEGRAM_BOT_TOKEN/ADMIN_CHAT_ID · CLOUDINARY_* · VOYAGE_* · APIFY_* · ENGAGEMENT_*/PUBLISH_* · SESSION_SECRET.
`META_REDIRECT_URI` 는 GitHub Pages 주소라 서버를 옮겨도 그대로. Threads 토큰은 DB 에 있음.

## 2. 새 서버 준비 (GCP e2-micro · 대안 Oracle 무료 ARM)
**사용자(직접) — GCP**: developers.google.com 에서 AI Pro 혜택 연결 → 크레딧을 Cloud 결제 계정에 추가 → Compute Engine VM 생성
- 리전 **us-central1 / us-west1 / us-east1** (e2-micro 무료 대상) · 머신 **e2-micro** · Ubuntu 24.04 · 표준 영구 디스크 30GB
- 방화벽: 기본(SSH)만 · 예산 알림 $10
- 램 1GB → 스크립트가 자동 저메모리 모드(스왑 4GB · worker+bot 만, api 제외)

**(대안) Oracle 무료**:
**사용자(직접)**: Oracle Cloud 가입(카드 본인확인만, Free Tier 유지 — "Upgrade" 누르지 말 것) → Compute 인스턴스 생성
- 리전: 서울 또는 춘천 · 이미지: Ubuntu 24.04 (또는 22.04) · Shape: **VM.Standard.A1.Flex (Ampere ARM) 2 OCPU / 12GB** (무료 한도 4/24 이내)
- "Out of capacity" 나오면 다른 가용 도메인·다른 시간에 재시도
- SSH 키 생성·다운로드 · 공인 IP 할당 · 보안 목록은 22번만 (기본값)

**서버에서 (새 Claude 가 SSH 로 진행 가능)**:
```bash
git clone https://github.com/outlawleojung/Pinpoint-Threads.git && cd Pinpoint-Threads
git checkout feature/naver-cta-button
# 로컬에서: scp -i <키> .env ubuntu@<IP>:~/Pinpoint-Threads/.env
bash scripts/deploy/setup-ubuntu.sh     # TZ=KST · Redis · Node22 · pnpm · pm2 · Playwright 크롬 · 스왑 · 방화벽
```
- Redis 는 apt 설치(docker 불필요). `.env` 의 REDIS_HOST=localhost 그대로.
- 실행은 `ecosystem.config.cjs`(pm2 · `node --import tsx` · 로컬 dev 와 같은 코드 경로, watch 없음). tsc 빌드 불필요.
- 집 PC 로 돌릴 경우: 위 대신 `docker compose up -d` + `pnpm run dev / dev:bot / dev:worker`.

## 3. 전환 순서 (반드시 이 순서)
1. **옛 PC 3개 프로세스를 먼저 완전히 끈다** (dev · dev:bot · dev:worker). 둘이 동시에 돌면 텔레그램 봇 충돌(409) + **같은 글 이중 발행**.
2. 새 머신에서 `npx tsx scripts/ops/reschedule-approved.mts` — 승인 대기 예약을 새 큐에 다시 배치 (안 하면 밀린 글이 안 나가거나 몰려 나감).
3. 새 머신 3개 프로세스 시작:
   - 집 PC: 지금처럼 `pnpm run dev` · `pnpm run dev:bot` · `pnpm run dev:worker`.
   - 서버: `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup` (출력되는 sudo 명령 1회 실행 → 재부팅해도 자동 시작). 로그 `pm2 logs`, 재시작 `pm2 restart all`, 코드 갱신 `git pull && pnpm install && pm2 restart all`.
4. 확인: `npx tsx scripts/ops/queue-status.mts` · 텔레그램에서 아무 카드 버튼 반응 · 다음 크론(08:20 소재 감시 / 20:00 스하리 카드) 실제 도착.

## 4. 새 Claude 계정에서 이어가기
- 새 대화 첫 메시지: "CLAUDE.md 대로 세션 시작 문서 읽고 이어가" — CLAUDE.md 가 런북·STATE·TASKS·세션 로그·`docs/memory/MEMORY.md` 를 순서대로 읽게 되어 있음.
- 새 계정의 자동 메모리는 비어 있음 → 첫 세션에서 `docs/memory/*.md` 를 새 메모리 폴더에 복사시키면 이전과 같은 응답 기준 유지.
- 운영 흐름(URL → urls-hold → frame-grid 직접 확인 → send-card)은 런북 2절. Relay 메타 확인은 `npx tsx scripts/ops/relay-meta.mts <URL>`.

## 5. 이전 시점 진행 중
- 쇼핑: pikkseetem(324) 링크 글 첫 테스트 — 사용자가 상품 소재 URL 을 천천히 보냄, 받을 때마다 확인·저장·카드.
- 스하리 첨부는 선택(없으면 텍스트) · 문구 다양화(각도 회전) 제안은 사용자 답 대기.
- _blanchatt_ 보류 · sookck 관찰 · pikkseetem 스하리 305뷰/댓글 29(10/27 이후 재탕 후보).

## 6. 서버 내린 시점 스냅샷 (2026-10-23 오전 · 옛 PC 종료)
- **APPROVED 예약 14건** (10/23 13:12 ~ 10/24 17:12) — 서버가 꺼진 동안 발행 안 됨. 새 서버 첫 실행 전 **반드시 `reschedule-approved`** (지난 예약을 현재 시각 이후로 재배치).
- **PENDING_APPROVAL**: 텔레그램 카드 다수 — 서버가 꺼져 있으면 카드 버튼 무반응. 새 서버(bot) 켜진 뒤 누르면 됨. 10/2~10/16 생성된 오래된 카드 6건은 폐기 대상.
- 쇼핑: 나이키 올블랙 10/22 19:14 발행 완료(pikkseetem). 보관 3건(뉴발 1906R 다색·메리제인·1906R 핑크)은 일상 4개 쌓인 뒤 하나씩 카드 (런북 7절).
- 스하리: 10/23 아침 sookck·pikkseetem 발행 완료. 보관함에 하얀 아깽이 사진 4장 · nikoandkota 고양이 2장 묶음.

## 7. ✅ 이전 완료 (2026-10-23 11:08 KST)
- GCP 프로젝트 `pinpoint` · VM `pinpoint` (us-central1-a · e2-micro · Ubuntu 24.04 · 표준 30GB · 스냅샷 없음) · 외부 IP 136.116.255.96(임시).
- 서버 `~/Pinpoint-Threads` · `.env` 업로드 · `setup-ubuntu.sh` 완료(저메모리 모드 · 스왑 4GB) · `reschedule-approved` 14건 재배치 · pm2 worker+bot online(재시작 0, 램 73%) · pm2 startup 등록.
- GitHub 저장소 비공개 전환 → 서버는 읽기전용 fine-grained 토큰(Contents RO · 2027-10-23 만료)으로 pull.
- **옛 PC 서버 종료. 로컬에서 dev/bot/worker 다시 켜지 말 것(이중 발행).** 운영 스크립트는 서버 SSH 에서 `npx tsx scripts/ops/...`.
