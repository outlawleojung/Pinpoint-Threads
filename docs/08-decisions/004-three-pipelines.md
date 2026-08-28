---
title: "ADR 004: 파이프라인 3개 구조 (A/B/C)"
tags: ["adr", "pipelines", "architecture"]
date: "2026-08-28"
status: "accepted"
---

# ADR 004: 파이프라인 3개 구조

## 상태
Accepted

## 컨텍스트
초기 계획은 A(쇼핑), B(스하리) 2개. 사용자님 수동 워크플로우 상세 청취 후 C(일상글) 신규 발견.

## 결정
- Pipeline A: 쇼핑 콘텐츠 (수익화, 링크 포함)
- Pipeline B: 스하리 (팔로워 부스팅, 일 1회)
- Pipeline C: 일상글 (엔게이지먼트, 수익화 없음, 어그로형)

세 파이프라인 모두 미디어 2개 이상 하드 룰 (B 예외).

## 결과
- CLAUDE.md에 C 파이프라인 추가 필요
- Planner/Auditor가 3개 믹스 결정
