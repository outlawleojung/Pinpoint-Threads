---
title: "데이터 수집 전략"
tags: ["data-collection", "scraping", "apify", "manual-seed"]
related: ["rag-design", "benchmark-schema", "lecture-knowledge"]
last_updated: "2026-08-29"
status: "active"
---
# 데이터 수집 전략

## 3가지 대상
1. 소스 콘텐츠 (Pipeline A/C 원본) — 해외 트렌드
2. 벤치마크 콘텐츠 (RAG few-shot용) — 국내 반응 폭발 글
3. 내 계정 성과 (셀프 개선) — Threads Graph API

## 수집 경로: 3-track 병행

자동 수집이 막힐 수 있으므로 수동 경로를 항상 보장한다.

### Track 1: 자동 수집 (Source Collector)
- Apify Actor 또는 자체 Playwright 스크래핑
- 터진 게시글 대량 수집 → AI 분석 → BenchmarkPost 저장
- **리스크**: Threads 안티봇, Meta 정책 변경으로 막힐 수 있음

### Track 2: 수동 시드 (Manual Seed)
- 사용자가 Telegram 봇에 Threads URL 전달
- 시스템이 해당 게시글 단건 크롤링 (텍스트, 미디어, 반응 수)
- AI가 viralFactors 분석 (왜 터졌는가)
- BenchmarkPost로 DB 저장 (origin: MANUAL_SEED)
- **장점**: Meta 승인 불필요, 안티봇 리스크 거의 없음 (단건), 항상 작동
- **플로우**: URL 전달 → 크롤링 → AI 분석 → DB 저장 → 확인 메시지

### Track 3: 내 계정 성과 회수 (Performance Collector)
- Threads Graph API로 발행한 게시글의 insights 회수
- engagementScore 계산 → 임계값 이상이면 BenchmarkPost 자동 승격
- **전제**: Meta API 승인 필요

## 전략

- Phase 4 초기: **Track 2 (수동 시드)를 주력으로** 시작. 사용자가 터진 글을 직접 찾아서 링크 전달
- Track 1 (자동 수집): Apify 시험 후 안정성 확인되면 병행
- Track 3: Publisher 가동 후 자동 작동
- Track 1이 막혀도 Track 2가 살아있으므로 피드백 루프는 유지됨
