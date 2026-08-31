---
title: "실서버 배포 전략 · 호스팅 옵션"
tags: ["deployment", "infrastructure", "hosting", "hetzner", "oracle-cloud"]
related: ["admin-auth", "publisher-dryrun-testing"]
last_updated: "2026-08-31"
status: "planned"
---

# 실서버 배포 전략

로컬 개발(사용자님 Windows PC) → 24/7 자율 운영 서버로 이전 계획.

## 왜 필요한가

Vision 원칙: "사용자 노동 없이 24/7 자율 운영".
로컬 PC에서 돌리는 한:
- PC 꺼지면 시스템 정지
- 매일 08:00 트렌드 다이제스트 · 08:30 자율 검색 · 6h 폴링 · 성과 회수 크론 모두 중단
- 사용자님 여행·수면 시 완전 정지

**Hetzner 등 VPS 이전 = vision 실현의 진짜 시작점.**

## 배포 시 실제 발생할 이슈 (체크리스트)

### 🔴 크리티컬
1. **OS 차이 (Windows → Linux)**: `node_modules` 재빌드, path separator, `pnpm-lock.yaml` 재생성 검토
2. **Meta OAuth 리다이렉트 URI**: 지금 GitHub Pages 브리지 → 서버 도메인으로 변경 · Meta 앱 콘솔 업데이트 · **5계정 재연결**
3. **HTTPS · SSL**: Threads OAuth · Cloudinary · Meta 강제. Cloudflare Tunnel(무료) 또는 Caddy/nginx
4. **세션 쿠키 `secure=true`**: 현재 `login-routes.ts`에 `secure: false` 하드코딩 → NODE_ENV 조건 분기 필요
5. **Redis 관리**: 로컬 Docker → VPS docker-compose 자체 호스팅 OR Upstash Redis (managed 무료 티어)

### 🟡 배포 후 곧 문제
6. **Process 관리**: 3개 프로세스(API·Worker·Bot) → pm2 / systemd / Docker Compose · 서버 재부팅 시 자동 시작
7. **로그 영속화**: stdout만으로는 사라짐 → pm2 로그 회전 · Sentry · Better Stack
8. **Secrets 관리**: `.env` 파일 SSH scp · `chmod 600`
9. **배포 자동화**: 초기 수동 · 이후 GitHub Actions + SSH 스크립트
10. **Prisma migration**: `prisma migrate deploy` (dev 아님) 실행

### 🟢 나중 문제
11. 백업 (Neon PITR 7일 무료 · Redis persistence 설정)
12. Cost tracking (Anthropic·Voyage·Apify 예산 알림)

## 호스팅 옵션 비교

### 🆓 완전 무료

**Oracle Cloud Always Free ARM ⭐ 최고 무료**
- Ampere A1: 최대 4 OCPU · 24GB RAM · 200GB SSD · 대역폭 10TB/월 · **영구 무료**
- 우리 워크로드 완전 커버
- ARM64 아키텍처 (Node·Prisma·bcryptjs 모두 정상)
- **catch**: 신용카드 인증 필요 · 셋업 복잡 · ARM 이미지 주의 · 요즘 신청 밀림
- 24/7 사용하면 회수 리스크 없음

**Fly.io 무료 티어**
- 3 shared-cpu-1x 256MB VM (합쳐서 우리 3 프로세스 정확)
- 5GB 볼륨 · 160GB 트래픽
- **catch**: 256MB로 Prisma·워커 빡빡, OOM 위험 · 무료 축소 추세

**Render 무료 · Cloudflare Workers**
- ❌ 부적합. Render는 15분 idle 시 잠들어 cron 안 돌아감. CF Workers는 long-running 프로세스 불가

### 💰 저렴 유료 (안정 우선)

**Hetzner CX22 ⭐ 밸런스 최고**
- €4.51/월 (~$5) = 2 vCPU · 4GB RAM · 40GB SSD · 20TB 트래픽
- 프로덕션 급 안정성
- Docker · SSH 자유

**DigitalOcean · Vultr $4~6**
- Hetzner 대비 이점 없음

## 부가 서비스

| 서비스 | 옵션 | 비용 |
|---|---|---|
| Redis | Upstash 무료 (10k cmd/day) or VPS 자체 | $0 |
| 도메인 | Namecheap `.xyz` 등 | 연 $2~5 |
| 도메인 | `.com` | 연 $10~13 |
| SSL | Cloudflare Tunnel 무료 | $0 |
| 모니터링 | Sentry 무료 (5K events) | $0 |

## 권장 시나리오 3가지

### 시나리오 A: 완전 무료 (Oracle)
```
Oracle Cloud Free Tier ARM VM         $0
  ├─ Docker Compose 3 프로세스 + Redis 자체 호스팅
  ├─ Cloudflare Tunnel (도메인 없어도 subdomain 자동)
  └─ 자체 도메인 원하면 Namecheap $2/년

총: $0/월
셋업: 3~4시간
리스크: Oracle 신청 대기 · ARM 호환성
```

### 시나리오 B: 최소 비용 ⭐ 권장
```
Hetzner CX22                           $5/월
  ├─ Docker Compose 3 프로세스 + Redis
  ├─ Cloudflare Tunnel (무료 SSL · 인바운드 포트 안 열음)
  └─ Cloudflare Access (Admin 이중 보안, 무료)

도메인 Namecheap .xyz                  $0.17/월 (연 $2)

총: ~$5/월
셋업: 2~3시간 · 표준화된 경로
안정성: 프로덕션 급
```

### 시나리오 C: Fly.io 무료 (권장 안 함)
```
Fly.io 3 VM (256MB × 3)                $0
Upstash Redis 무료                     $0

총: $0/월
리스크: 메모리 부족 · 무료 정책 변동
```

## 배포 표준 아키텍처 (시나리오 B 기준)

```
GitHub (main branch)
     ↓ git pull (수동 or GitHub Actions)
Hetzner CX22 (Debian 12)
  ├─ Docker Compose
  │   ├─ pinpoint-api      (node dist/index.js)
  │   ├─ pinpoint-worker   (node dist/worker.js)
  │   ├─ pinpoint-bot      (node dist/bot.js)
  │   └─ redis
  ├─ Caddy (자동 SSL · reverse proxy)
  └─ .env (chmod 600)

Cloudflare (DNS + Zero Trust Access)
  ↓
Cloudflare Tunnel (인바운드 포트 안 열어도 됨)
  ↓
Hetzner Caddy → 각 Node 프로세스

도메인: pinpoint.<domain>.com
```

## 배포 전 로컬 검증 순서 (필수)

프로덕션에서 처음 돌면 지금 미검증 코드가 대량 이슈 발생. 로컬에서 최대한 검증 후 이전.

1. **Publisher dry-run 5계정 검증** ([publisher-dryrun-testing.md](publisher-dryrun-testing.md))
2. **실 발행 1회 방치 검증** (가장 팔로워 적은 계정)
3. **각 URL 어댑터 실 URL로 검증** (Threads · TikTok · IG · 샤오홍슈)
4. **각 트렌드 소스 실 실행 검증** (네이버·구글·쿠팡·TikTok CC)
5. **BullMQ 워커 하루 이상 돌려서 크론 검증**
6. **Apify 세팅 후 트렌드 검색 → 인제스트 → 승격 파이프라인 e2e**
7. **그 다음 Hetzner 이전** (검증된 코드니 이슈 최소)

## 배포 시 사용자 액션 체크리스트

Hetzner 배포 결정 시:

- [ ] Hetzner 계정 · CX22 인스턴스 생성 · Debian 12 · SSH 키 등록
- [ ] 도메인 구매 · Cloudflare에 등록 · Nameserver 변경
- [ ] Cloudflare Tunnel 설치 · 서비스 등록
- [ ] Cloudflare Access application 생성 (Admin 접근용)
- [ ] Docker · Docker Compose · Node 20 설치 (또는 Docker 이미지 내부)
- [ ] `.env` 서버로 이전 (SSH scp · `chmod 600`)
- [ ] `META_REDIRECT_URI` 를 서버 도메인으로 갱신 (`https://pinpoint.<domain>.com/oauth/threads/callback`)
- [ ] Meta 앱 콘솔 → Threads 앱 → 리디렉션 콜백 URL 새 값 추가
- [ ] 5계정 재연결 (`/oauth/threads/start`)
- [ ] `SESSION_SECRET` 32자+ 강한 값으로 재발급
- [ ] `login-routes.ts` 세션 쿠키 `secure=true` 조건 분기 코드 추가
- [ ] `prisma migrate deploy` 실행 (Neon 스키마는 이미 최신, 재실행 무해)
- [ ] Docker Compose 기동 · 로그 확인
- [ ] `/healthz` · `/admin/login` 정상 확인
- [ ] BullMQ 워커 로그 · 다음 크론 실행 관찰

## 예상 셋업 시간

| 단계 | 시간 |
|---|---|
| Hetzner 인스턴스 · SSH · Docker | 45분 |
| 도메인 · Cloudflare · Tunnel · Access | 60분 |
| 코드 배포 · 첫 실행 | 30분 |
| Meta OAuth URL 갱신 · 5계정 재연결 | 30분 |
| Docker restart 정책 · 로그 확인 | 30분 |
| 트러블슈팅 예비 | 60분 |
| **총** | **약 4시간** |

## 리스크

- **Meta 5계정 재연결** — 리다이렉트 URI 변경으로 OAuth 흐름 다시 (큰 문제는 아니지만 시간 필요)
- **첫 실행 시 미검증 코드 실행** — 로컬에서 안 돌린 것들이 프로덕션에서 처음 돌면 이슈 다수
- **개발 흐름 변화** — hot reload 못 함 · git push → 배포 사이클

## 최종 권장

**로컬 검증 완료 후 시나리오 B (Hetzner + Cloudflare Tunnel + Access)** = $5/월로 프로덕션 급 안정 · 표준화된 경로.

Oracle 무료도 좋지만 셋업 복잡성 · ARM 호환성 이슈 감안하면 시간 대비 가치 낮음. 진짜 $0 예산이면 그때 재검토.

## 관련 문서

- [admin-auth.md](admin-auth.md) — Cloudflare Access 세부 설정
- [publisher-dryrun-testing.md](publisher-dryrun-testing.md) — 배포 전 실 발행 검증
- [00-overview/vision.md](../00-overview/vision.md)
- [STATE.md](../STATE.md)
