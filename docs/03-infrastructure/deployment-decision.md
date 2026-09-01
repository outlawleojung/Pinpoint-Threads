---
title: "배포 결정 · AWS Lightsail Seoul"
date: 2026-09-01
status: "confirmed"
---

# 배포 결정 (2026-09-01)

## 확정: **AWS Lightsail Seoul $5/월**

### 요구사항 (고정)
- 저렴 (월 만원 이하)
- 신뢰 있는 회사
- 국내 접속 빠름 (Neon 위치와도 가까움)
- 폭탄 청구 없음
- 24/7 워커 상주 가능

### 결정 이유
- **AWS 브랜드** = 신뢰 최상
- **Lightsail = flat rate** = 폭탄 청구 원천 차단 (EC2와 다름)
- **서울 리전** = 국내 최속
- Neon `ap-southeast-1`(싱가포르)과 latency ~50ms
- 12개월 후에도 $5 유지 (Free tier 종료 리스크 없음)
- 결제 실패·용량 부족 리스크 없음

### 스펙
- 1 vCPU · 1GB RAM · 40GB SSD · 2TB traffic
- Ubuntu 24.04 LTS
- Seoul region (ap-northeast-2)

## 검토했으나 배제된 옵션

| 옵션 | 배제 이유 |
|---|---|
| **Oracle Cloud Always Free** | $0이지만 카드 거부·계정 심사·ARM VM capacity 부족 리스크 (며칠 대기 가능성) |
| **Hetzner CX22 (€4.51)** | EU 위치로 국내 접속 느림 · 국내 인지도 낮아 사용자 신뢰 부족 |
| **AWS EC2** | 사용량 기반 과금 → 폭탄 청구 리스크 (Lightsail은 정액제) |
| **Azure B2s** | ~$30/월로 비쌈 |
| **DigitalOcean Singapore** | $6로 저렴하지만 서울 리전 없음 |
| **Vultr Seoul** | $6 · 신뢰도 Lightsail보다 낮음 |
| **Naver Cloud** | 국내 결제·지원 강점 있으나 ~₩10,000으로 상대적 고가 |

## 배포 로드맵

1. **AWS 계정 준비** (사용자)
2. **Lightsail 인스턴스 생성** — Seoul · Ubuntu 24.04 · $5 plan
3. **SSH 키 · 고정 IP · 방화벽** — 22(SSH) · 3000(Fastify) · Telegram outbound
4. **서버 초기 셋업** — Node 20 · pnpm · Redis · PM2 · (선택) Nginx
5. **환경변수 이전** — 로컬 `.env` → 서버
6. **첫 수동 배포** — git clone → prisma migrate deploy → PM2 start
7. **GitHub Actions CI/CD** — push main → SSH → git pull + install + migrate + pm2 restart

## 인프라 전체 현황 (2026-09-01)

| 컴포넌트 | 상태 | 위치 |
|---|---|---|
| DB (Neon Postgres + pgvector) | ✅ 운영 | ap-southeast-1 (싱가포르) |
| 서버 (Fastify + BullMQ worker) | 🟡 배포 전 | 로컬 → AWS Lightsail Seoul (진행 중) |
| 미디어 (Cloudinary) | ✅ 운영 | 글로벌 CDN |
| 스크래핑 (Apify) | ✅ 운영 | 글로벌 |
| LLM (Anthropic Claude) | ✅ 운영 | 글로벌 |
| 임베딩 (Voyage AI) | ✅ 운영 (rate limit 있음) | 글로벌 |

**월 예상 비용 (5계정 기준)**:
- Lightsail: $5
- Neon: 무료 티어
- Apify: ~$4–5
- Anthropic: ~$5–10
- Cloudinary: 무료 티어
- **합계**: **월 ~$14–20 (~₩20,000–28,000)**
