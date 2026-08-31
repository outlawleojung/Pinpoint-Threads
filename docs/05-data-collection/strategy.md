---
title: "데이터 수집 전략 v2"
tags: ["data-collection", "apify", "manual-seed", "rss"]
related: ["rag-design", "benchmark-schema", "lecture-knowledge"]
last_updated: "2026-08-31"
status: "active"
---
# 데이터 수집 전략 v2

> 2026-08-31 실 검증 결과 반영. 기존 OG 파싱 전략 전멸 → Apify + 수동 시드 + RSS 기반으로 재설계.

## 3가지 대상
1. 소스 콘텐츠 (Pipeline A/C 원본) — 해외 트렌드
2. 벤치마크 콘텐츠 (RAG few-shot용) — 국내 반응 폭발 글
3. 내 계정 성과 (셀프 개선) — Threads Graph API

## 수집 레인 3개

### Lane 1: 수동 시드 (텔레그램 → URL/텍스트 인제스트) — **주력**

사용자가 각 플랫폼 앱에서 터진 글 발견 → 텔레그램에 URL 또는 텍스트 붙여넣기.
시스템이 플랫폼 감지 → Apify로 본문/미디어/엔게이지먼트 fetch → DB 저장 → AI 분석.

- **항상 작동.** Apify 없어도 텍스트 직접 입력(`/seed`)으로 fallback.
- Threads, Instagram, TikTok, 샤오홍슈 모두 이 경로로 데이터 축적.
- **Threads는 검색 API가 없으므로 이 레인이 유일한 Threads 콘텐츠 진입점.**

### Lane 2: 자율 트렌드 추적 (크론 → 트렌드 시그널) — 방향 제시

6시간마다 Google Trends RSS · 쿠팡 랭킹 · 네이버 데이터랩 폴링 → TrendSignal DB.
매일 08:00 텔레그램 다이제스트 → 사용자가 관심 키워드로 L1 시드.

- Threads 자율 발견 불가 (검색 API 없음). 다이제스트가 "이 키워드 찾아봐" 힌트 역할.
- TikTok/Instagram/샤오홍슈: Apify 키워드 검색 액터 설정 시 자동 URL 수집 가능 (Phase 5+).
- 트렌드 시그널은 **콘텐츠 기획 방향 제시**가 핵심 가치.

### Lane 3: 내 계정 성과 회수 (Threads Graph API) — 독립

발행한 게시글의 likes/replies/views 회수 → engagementScore 계산 → 자체 벤치마크 승격.
Meta API 승인 필요. L1·L2와 독립.

## 핵심 변경점 (v1 → v2)

| 항목 | v1 (기존) | v2 (현재) |
|---|---|---|
| 콘텐츠 fetch | HTML OG 파싱 | **Apify Actor** (OG는 fallback) |
| Google Trends | `google-trends-api` npm | **RSS 직접 파싱** (라이브러리 제거) |
| 주력 경로 | 자동 수집 주력, 수동 보조 | **수동 시드(L1) 주력**, L2는 방향 제시 |
| Threads 발견 | 자동 수집 가정 | **수동 큐레이션 유일** (검색 API 없음) |
| 최소 보장 | URL fetch 필수 | **텍스트 직접 입력** (`/seed`) |

## 플랫폼별 fetch 방식

| 플랫폼 | 단건 URL (L1) | 키워드 검색 (L2) | 비용 |
|---|---|---|---|
| Threads | Apify Actor | 불가 (API 없음) | ~$0.01-0.05/건 |
| Instagram | Apify Actor | Apify 키워드 액터 (Phase 5+) | ~$0.01-0.05/건 |
| TikTok | oEmbed (디버깅 중) or Apify | Apify 키워드 액터 (Phase 5+) | $0 or Apify |
| 샤오홍슈 | Apify Actor (원래 계획대로) | Apify 키워드 액터 (Phase 5+) | ~$0.05/건 |

## 트렌드 소스 현황

| 소스 | 상태 | 비고 |
|---|---|---|
| Google Trends RSS | ✅ 작동 | RSS 직접 파싱 (교체 완료) |
| 쿠팡 Best/Search API | ✅ 작동 | HMAC 서명, 8개 카테고리 |
| 네이버 데이터랩 | ⚪ 키 미발급 | 무료, 사용자 액션 필요 |
| TikTok Creative Center | 미검증 | 별도 검증 필요 |

## Threads 수집의 현실적 한계

Threads에는 공개 검색 API가 없다. Threads 콘텐츠 수집 경로:

1. **수동 URL 시드 (L1)** — 사용자가 Threads 앱에서 터진 글 발견 → 텔레그램에 URL 전달
2. **트렌드 다이제스트 연계** — L2가 "오늘 뜨는 키워드" 알림 → Threads 앱에서 검색 → URL 전달
3. **텍스트 직접 입력** — Apify 없이도 본문 텍스트 붙여넣기 → AI 분석용 벤치마크 저장

## 텍스트 직접 입력 경로 (신규)

URL 없이도 데이터를 축적할 수 있는 최소 경로. Apify 미설정 상태에서도 작동.

```
[threads] @zuck
AI 시대에 가장 중요한 건 결국 실행력이라고 생각해요...
좋아요 12.5K 댓글 890
```

→ InboundLink + BenchmarkPost 저장 → AI viralFactors 분석 → RAG few-shot 데이터 축적.

## 비용 예측 (Phase 4)

- Google Trends RSS / 쿠팡 API / 네이버 데이터랩: **무료**
- Apify 단건 URL fetch: **~$0.01-0.05/건** (Free tier $5/월 ≈ 100-500건)
- **Phase 4 예상: $0-5/월** (수동 시드 중심)
