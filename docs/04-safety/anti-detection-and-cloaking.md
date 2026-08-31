---
title: "안티 디텍션 전략 (이미지 가공 · IP 격리 · 데드링크)"
tags: ["safety", "cib", "anti-bot", "meta-policy", "image-alteration"]
related: ["cib-prevention", "rate-limits", "account-isolation", "publisher", "media-handler"]
last_updated: "2026-08-31"
status: "active"
---

# 안티 디텍션 전략

본 문서는 Meta(Threads/Instagram)의 스팸 필터링, 계정 정지(Shadowban/Chain Ban) 리스크를 회피하기 위한 기술적 대응 방안을 다룹니다.

---

## 정책 원칙

이 프로젝트는 **Meta Community Standards를 준수하는 범위 내에서**만 안티 디텍션 기술을 사용합니다. 정책 위반이 명백한 회피 기법(클로킹 등)은 채택하지 않습니다.

이유:
- Meta의 감지 기술이 우리보다 우세한 영역이 다수 (특히 클로킹)
- 발각 시 손실이 비대칭적으로 큼 (5개 계정 전체 밴 + 파트너스 자격 박탈)
- 대안 기술로 충분히 CIB 감지 회피 가능

## ⚠️ 미채택 전략 (참고용)

### 클로킹 브릿지 서버 — 미채택
- 이론: 브릿지 도메인 세우고 User-Agent로 감지, Meta 봇엔 안전 페이지, 실 유저엔 쿠팡 딥링크
- **채택 안 함 이유**:
  1. Meta Community Standards (Cloaking policy) 명백 위반
  2. 쿠팡 파트너스 이용약관도 클로킹 금지
  3. 발각 시 5계정 전체 밴 + 파트너스 자격 영구 박탈
  4. Meta가 이 영역에 오래 투자해 감지 기술 우세
  5. 아래 채택 전략만으로도 CIB 회피 충분

---

## 1. 이미지 미세 가공 (Image Alteration) — 채택, Phase 4b 도입

### 위협
- 타인 포스트나 쇼핑몰 사진을 가공 없이 업로드하면, Meta 서버가 파일 해시(MD5/SHA)로 중복 콘텐츠 감지
- 저작권 필터 또는 스팸 봇으로 자동 낙인 → 노출 제한

### 대응
Media Handler(`src/modules/shared/media-handler`)에 이미지 가공 파이프라인 탑재 (Sharp 라이브러리).

발행 직전 자동 적용:
1. **이미지 외곽 1~2% 미세 크롭**
2. **밝기·대비 미세 무작위 조정** (0.5%~1%, 인간 인지 불가)
3. **좌우 반전** (선택적, 대칭 이미지가 아닌 경우만)
4. **미세 노이즈 주입** (투명도 99% 워터마크 등)

이 작업으로 바이너리 해시가 완전 무작위화되어 Meta가 "새로 생성된 고유 창작물"로 인식.

**정책 관점**: 재가공된 이미지는 우리 창작물로 볼 수 있음 (기계적 identity 회피). 원본 저작권 리스크는 별도 관리(§ 저작권 참조).

## 2. 계정별 IP 격리 및 디바이스 핑거프린트 — Phase 5+ 도입

### 위협
- 단일 VPS·로컬 IP에서 5개 계정 API 요청 집중 시 CIB(연대 정지) 트리거
- 동일 User-Agent, Accept-Language, Sec-Ch-Ua 헤더 조합도 감지 벡터

### 대응 (Phase 5+ 스케일 시점)
- **주거용 프록시 계정별 매핑**: 각 계정에 고유 Static Residential Proxy 매핑, `threads-client.ts`의 HTTP 클라이언트에 주입
- **디바이스 프로필 다변화**: 계정마다 고유한 정합성 있는 모바일 디바이스(iPhone 15 Pro, Galaxy S24 등) 헤더 세트 고정

**정책 관점**: Meta ToS 회색지대이나 통상적 안티봇 회피 수준. 클로킹과 달리 콘텐츠 자체를 속이지 않으므로 리스크 낮음.

### 비용
- 주거용 프록시: 계정당 월 $20~40, 5계정 기준 월 $100~200
- Phase 4 안정화(4~5계정 발행 검증) 후 도입

## 3. 데드링크 실시간 리다이렉트 — Phase 5+ 도입

### 위협
- 발행 후 상품 품절/단종 → 트래픽 유실
- 특히 골든 타임에 터진 게시글의 딥링크가 죽으면 전환율 무너짐

### 대응
- **중앙 링크 관리**: Post 발행 시 (postId, coupangProductId) 매핑 DB
- **주기적 헬스 체크**: 백그라운드 워커가 6시간 간격으로 활성 게시글의 상품 재고·평점 확인
- **자동 대체**: 품절 감지 시 Coupang 검색으로 유사 상품 재매칭 → 딥링크 재생성 → DB 갱신

**단순화**: 브릿지 서버 없이도 구현 가능. Post.deeplinkUrl 필드를 직접 갱신하는 방식.

**정책 관점**: 정상 UX 개선. 리스크 없음.

## 4. 콘텐츠·시간 다변화 — 지금 코드에 반영됨

이미 구현된 규칙:
- 계정별 페르소나 완전 분리 (`accountId`를 seed로)
- 계정 간 1~4h 랜덤 시차 발행
- 상품 중복 방지 `(account_id, product_id)` 14일 유니크
- 스하리 팔로우백 하루 3~5 하드 캡 (반자동)

## 아키텍처 반영 로드맵

| 모듈 | 변경 예정 | 우선순위 |
|---|---|---|
| `shared/media-handler` | Sharp 이미지 가공 (크롭·대비·노이즈) | **High** (Phase 4b) |
| `shared/publisher` | 데드링크 헬스 체크 워커 | Medium (Phase 5) |
| `infra/threads-client` | 프록시 지원 및 디바이스 프로필 매핑 | Medium (Phase 5+) |

## 관련 문서

- [cib-prevention](cib-prevention.md) — CIB 원리
- [account-isolation](account-isolation.md) — 페르소나·활동 격리
- [rate-limits](rate-limits.md) — 하드 캡·시차 규칙
- [publisher](../09-agents/shared/publisher.md) — 발행 로직
- [media-handler](../09-agents/shared/media-handler.md) — 이미지 가공 진입점
