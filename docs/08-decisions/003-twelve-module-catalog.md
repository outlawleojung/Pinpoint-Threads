---
title: "ADR 003: 런타임 모듈 12개로 축약"
tags: ["adr", "architecture", "agents"]
date: "2026-08-28"
status: "accepted"
---

# ADR 003: 런타임 모듈 12개로 축약

## 상태
Accepted

## 컨텍스트
파이프라인 상세 역할을 25개까지 나눌 수 있었으나, 초기 오버 엔지니어링 우려.

## 결정
12개 모듈로 축약:
- shared: source-collector, content-classifier, copywriter, media-handler, publisher, approval-gate, performance-collector, planner-auditor
- pipeline-a: product-matcher, vision-verifier, reply-composer
- pipeline-b: engagement-worker

AI 호출은 12개 중 3개(classifier, vision-verifier, copywriter)에만.

## 결과
- 초기 구축 오버헤드 최소
- 필요 시 각 모듈 세분화 가능 (문서 파일 분리)
