---
title: "Admin 라우트 인증"
tags: ["security", "infrastructure", "admin", "auth"]
related: ["deployment"]
last_updated: "2026-08-31"
status: "active"
---

# Admin 라우트 인증

`/admin/*` 및 `/oauth/threads/accounts` 라우트는 이중 방어로 보호.

## Layer 1: Basic Auth (앱 레벨, 항상)

`@fastify/basic-auth` 플러그인. 모든 환경에서 필수.

### 설정
```
# .env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<강한 랜덤 문자열>
```

### 보호 경로
- `/admin/*` (전체)
- `/oauth/threads/accounts` · `/oauth/threads/accounts/*`

### 예외 (인증 skip)
- `/oauth/threads/start` — Meta 리다이렉트 시작점
- `/oauth/threads/callback` — Meta에서 리다이렉트 수신
- `/healthz` — health check

### 미설정 시 동작
- 개발 편의로 인증 없이 통과 + 경고 로그
- **프로덕션 이전 전 반드시 설정**

## Layer 2: Cloudflare Access (프로덕션, 권장)

Basic Auth 위에 추가로 CF Zero Trust 배치. **비밀번호 유출·brute force 완전 차단**.

### 왜 이중화하나
- Basic Auth만: 비밀번호 유출 시 즉시 뚫림
- CF Access만: CF 장애 시 노출
- 둘 다: 한 층 뚫려도 다른 층이 남음

### 설정 (Hetzner 이전 후)

1. **도메인을 Cloudflare에 등록** (무료)
2. **Cloudflare Zero Trust → Access → Applications → Add**
3. Application type: **Self-hosted**
4. Application domain: `admin.pinpoint-threads.example.com`
5. Session duration: 24h
6. **Policy 추가:**
   - Name: "Admin only"
   - Action: Allow
   - Include: `Emails` → `healingsam1003@gmail.com`
7. **Identity Provider**: One-time PIN (이메일로 코드 발송, 별도 SSO 불필요)

### 접속 흐름
```
사용자 → admin.pinpoint-threads.example.com
       ↓
CF Access가 이메일 입력 요구
       ↓
이메일로 6자리 코드 받음 → 입력
       ↓
Cf-Access-Jwt-Assertion 쿠키 발급 (24h)
       ↓
Hetzner 서버로 프록시
       ↓
Basic Auth (Layer 1) 프롬프트
       ↓
Admin UI 접근
```

### 비용
- Free tier: 50명까지 무제한
- 우리는 사용자님 1명 → 완전 무료

### Cloudflare 없이 CF Access만 쓰는 대안
- **Cloudflare Tunnel + Access**: 서버가 인바운드 포트 열 필요 없음
- SSL 자동, DDoS 보호 자동
- 서버 IP 완전 은닉

## 프로덕션 배포 체크리스트

Hetzner 이전 시:
- [ ] `ADMIN_PASSWORD` 강한 랜덤 (32자 이상)
- [ ] `.env` 파일 권한 `chmod 600`
- [ ] CF Tunnel 설정 → 서버 인바운드 포트 닫기
- [ ] CF Access application 생성 · 이메일 정책 등록
- [ ] `/healthz` 만 CF 우회 허용 (모니터링용)
- [ ] Basic Auth 실패 시 fail2ban으로 IP 차단 (선택)

## 관련 문서

- [deployment](deployment.md) (예정)
- [credentials](../06-accounts/credentials.md)
