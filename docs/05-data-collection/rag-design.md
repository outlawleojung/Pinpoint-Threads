---
title: "RAG 설계"
tags: ["data-collection", "rag", "vector-search"]
related: ["benchmark-schema", "copywriter"]
last_updated: "2026-08-28"
status: "draft"
---
# RAG 설계

_아직 미작성. 브레인스토밍 진행하며 채워짐._

## 핵심
- Voyage AI 임베딩 (multimodal, 텍스트+이미지)
- pgvector cosine similarity + engagement 가중치
- Top-K 5개 few-shot 주입
- 임계 데이터량 도달 시 정적 카피 → RAG 카피 자동 전환
