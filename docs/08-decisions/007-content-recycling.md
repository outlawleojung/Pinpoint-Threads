---
title: "ADR 007: 콘텐츠 재활용 전략 도입"
tags: ["adr", "content-recycling", "benchmark", "planner"]
date: "2026-08-28"
status: "accepted"
---

# ADR 007: 콘텐츠 재활용 전략 도입

## 상태
Accepted

## 컨텍스트
사용자님 실제 워크플로우에서 "반응 좋은 콘텐츠는 재활용을 많이 한다"가 확인됨. 이건 소싱 부담을 크게 줄이는 검증된 전략. 또한 시스템 확장성(수십~수백 계정)을 고려하면 재활용 없이는 콘텐츠 수급 불가능.

## 결정

BenchmarkPost 스키마에 재활용 관리 필드 추가:
- `usedByAccounts[]`, `usedAt[]` — 사용 이력 추적
- `recycleEligibleAt` — 다음 재활용 가능 시점
- `isEvergreen` — 시의성 없는 상시 콘텐츠 플래그
- `recycleCount`, `maxRecycles` — 재활용 상한

Planner에 재활용 배치 규칙 추가:
- 벤치마크 풀 크기별 신규:재활용 비율 (풀 < 50이면 신규 100%, 200+ 안정기는 50:50)
- 같은 계정 재사용 최소 간격 90일 (evergreen 30일)
- 다른 계정 배치 시 페르소나 완전 다르게

승격 규칙:
- 우리가 발행한 게시글 중 engagementScore >= 0.15 → BenchmarkPost 자동 편입
- Evergreen 자동 판정: 3회 재활용에도 성과 유지 시

## 결과

- 소싱 필요량 감소 (하루 신규 소스 부담 절반)
- 검증된 히트 콘텐츠의 수명 연장
- 계정 확장 시 콘텐츠 수급 병목 완화
- BenchmarkPost 스키마가 RAG few-shot + 재활용 풀 두 목적 겸용

## 관련 문서

- [benchmark-schema](../05-data-collection/benchmark-schema.md)
- [planner-auditor](../09-agents/shared/planner-auditor.md)
