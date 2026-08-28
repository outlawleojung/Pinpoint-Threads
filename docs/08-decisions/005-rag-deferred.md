---
title: "ADR 005: RAG 도입 시점 - 데이터 임계량 후 자동 전환"
tags: ["adr", "rag", "data-collection"]
date: "2026-08-28"
status: "accepted"
---

# ADR 005: RAG 도입 시점

## 상태
Accepted

## 컨텍스트
"수집 후 벡터화 저장하면 RAG는 사실상 이미 준비된 것" 지적으로 이분법 폐기.

## 결정
- 데이터 수집·벡터DB 저장은 처음부터 진행
- 카피 생성은 정적 프롬프트로 launch
- 임계량 도달 시 자동으로 RAG few-shot 모드 활성화
- 이분법 아님, 임계량 자동 스위칭

## 결과
- 벤치마크 최소 임계량 정의 필요 (예: 500건 최근 7일)
- 자동 전환 로직 구현 필요 (Copywriter 모듈 내부)
