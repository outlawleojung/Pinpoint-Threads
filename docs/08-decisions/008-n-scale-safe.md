---
title: "ADR 008: N-Scale Safe 설계 원칙"
tags: ["adr", "architecture", "scalability"]
date: "2026-08-28"
status: "accepted"
---

# ADR 008: N-Scale Safe 설계 원칙

## 상태
Accepted

## 컨텍스트
사용자님이 "확장 목표를 고정 숫자(4/30/100)로 잡지 말고, 무한 확장 가능성을 열어두자"고 제시. 강사 사례(30계정 월 3천만~1억) 및 잠재 확장을 고려하면 특정 N에 최적화된 설계는 발목을 잡음.

## 결정

**모든 설계에 "N-Scale Safe" 원칙 적용:**

1. 코드에 계정 수를 하드코딩하지 않음. 설정·DB에서만 결정.
2. 각 컴포넌트의 스케일 한계 시점을 사전에 매핑하여 [scaling-limits](../03-infrastructure/scaling-limits.md)에 명시.
3. Rate limit·비용 알림·모니터링은 N 무관하게 동작.
4. DB 스키마·인덱스는 수만 계정 규모도 견디게 (이미 CUID + 인덱스 잘 됨).
5. 각 스케일 임계점(5/20/100/500)에서 어느 컴포넌트가 먼저 깨지고, 무엇을 업그레이드해야 하는지 문서화.

## 스케일 임계점 개요

| N | 병목 | 대응 |
|---|---|---|
| ~5 | 없음 | 지금 설계로 충분 |
| ~20 | Telegram 승인 부하 | 웹 대시보드 검토 |
| ~100 | IP 다양성, 승인 인력 | 주거용 프록시, 파트타임 승인 인력 |
| ~500 | 인프라 전반, 계정 팜 | 팀 운영, 인프라 확장 |

## 결과

- 지금부터 어느 규모로도 성장 가능
- 각 병목 시점을 예측 가능하여 준비 가능
- 특정 규모 도달 시 코드 재작성 없이 인프라만 확장

## 관련 문서

- [scaling-limits](../03-infrastructure/scaling-limits.md)
- [cost-model](../03-infrastructure/cost-model.md)
- [deployment](../03-infrastructure/deployment.md)
