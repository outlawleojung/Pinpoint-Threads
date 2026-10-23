---
name: project-gcp-deployment
description: "2026-10-23 서버를 GCP e2-micro(us-central1, 프로젝트 pinpoint)로 이전 완료 · pm2 worker+bot · 옛 PC 종료"
metadata:
  type: project
---

2026-10-23 사용자 퇴사로 로컬 PC 서버 종료 → **GCP Compute Engine e2-micro**(프로젝트 `pinpoint`, us-central1-a, Ubuntu 24.04, 표준 디스크 30GB, 스냅샷 없음) 이전 완료.
- 접속: GCP 콘솔 VM 목록 → SSH 버튼 (사용자 계정 outlawleojung). 코드 `~/Pinpoint-Threads` (브랜치 feature/naver-cta-button, GitHub 비공개 · 읽기전용 fine-grained 토큰이 서버 credential store 에 저장).
- 실행: pm2 `worker`+`bot` (저메모리 · api 제외) · pm2 startup 등록. 로그 `pm2 logs`, 갱신 `git pull && pnpm install && pm2 restart all`.
- 비용: 무료 사용량(e2-micro) + Google AI Pro 개발자 혜택 월 $10 GCP 크레딧 · 결제계정 업그레이드됨 · 예산 알림 권장 ₩15,000.
- 운영 스크립트(scripts/ops/*)는 이제 서버 SSH 에서 실행.

**Why:** 사용자 카드 신규 등록 거부(Oracle X) · 구글 결제 프로필 재사용 OK.
**How to apply:** 새 머신·새 Claude 는 서버에 SSH 로 들어가 작업. 로컬에서 dev 서버를 다시 켜면 봇·발행 이중 실행 → 금지. 관련: [[reference-ops-runbook]]
