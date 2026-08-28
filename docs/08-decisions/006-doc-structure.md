---
title: "ADR 006: 인덱스 기반 분리 문서 구조"
tags: ["adr", "docs", "workflow"]
date: "2026-08-28"
status: "accepted"
---

# ADR 006: 인덱스 기반 분리 문서 구조

## 상태
Accepted

## 컨텍스트
CLAUDE.md가 부풀면 매번 전체 로드하게 되어 컨텍스트 낭비. 타 AI(GPT/Codex/Gemini)와의 호환도 고려 필요.

## 결정
- CLAUDE.md는 최소 정체성만 유지 (100줄 이내)
- AGENTS.md 미러링 (타 AI 호환)
- 상세 규칙은 docs/ 폴더 8개 카테고리 + INDEX.md
- 각 문서 상단에 tags/related 프론트매터
- ADR로 결정 사항 이력 관리

## 결과
- 필요한 부분만 검색·로드 가능
- 결정 사항이 뒤엎일 때 이력 명확
- 타 AI가 프로젝트 규칙 자동 인지
