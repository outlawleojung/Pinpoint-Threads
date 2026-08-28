---
title: "ADR 002: Neon 클라우드 Postgres 처음부터 도입"
tags: ["adr", "database", "infrastructure"]
date: "2026-08-28"
status: "accepted"
---

# ADR 002: Neon 클라우드 Postgres 처음부터 도입

## 상태
Accepted

## 컨텍스트
초기 로컬 Docker Postgres에서 나중에 클라우드 이관할지, 처음부터 클라우드로 갈지.
데이터 수집이 처음부터 축적되어야 하므로 이관 작업은 "2번 일하기"가 됨.

## 결정
- Neon 클라우드 Postgres를 처음부터 사용
- 로컬 개발도 Neon에 연결 (인터넷 필요, 실제로 지장 없음)
- pgvector 확장으로 임베딩 저장 동일 DB에서 처리
- 로컬 Docker Postgres는 제거

## 결과
- 이관 작업 완전 제거
- 어느 환경에서든 같은 데이터 접근
- 월 비용: 무료 티어(500MB)로 시작 → 필요 시 $19/월 유료
