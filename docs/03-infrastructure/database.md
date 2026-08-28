---
title: "DB 인프라 (Neon + pgvector)"
tags: ["infrastructure", "database", "neon", "pgvector"]
related: ["tech-stack", "benchmark-schema", "rag-design", "local-dev"]
last_updated: "2026-08-28"
status: "active"
---

# DB 인프라

## 현재 상태 (ADR 002 반영)

- **Provider**: Neon (https://neon.tech)
- **Region**: AWS Asia Pacific 1 (Singapore, `ap-southeast-1`)
  - 한국까지 40~60ms — 서버-서버 통신용 문제없음
  - 향후 Seoul region 옵션 나오면 이관 가능
- **Postgres 버전**: 17
- **Plan**: Free tier (500MB 저장, 100 CU-hrs/월)
- **pgvector**: 0.8.6 활성화됨 (BenchmarkPost 임베딩용)

## 접속

`.env`의 `DATABASE_URL`에 Neon connection string:
```
postgresql://neondb_owner:npg_xxx@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

로컬 개발도 이 클라우드 DB에 연결. 별도 로컬 Postgres 없음.

## 확장 (Extensions)

```sql
CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector 0.8.6
```

## 마이그레이션

```bash
npx prisma migrate deploy    # 프로덕션 (Neon)
npx prisma migrate dev       # 개발 (스키마 변경 시)
```

## 스키마

`prisma/schema.prisma` 참조. 주요 모델:
- Account, SourceItem, CommerceProduct, Post, EngagementLog, DailyPostCount
- BenchmarkPost (예정 — [benchmark-schema](../05-data-collection/benchmark-schema.md))

## 스케일링

Free tier 한계 도달 시 [scaling-limits](scaling-limits.md) 참조:
- ~5 계정: Free (충분)
- ~20 계정: Pro $19/월
- ~100 계정: Pro (~10GB)
- > 100 계정: Scale-plus $100+

## Neon 특징 활용

- **Branching**: dev/staging/prod DB를 브랜치로 분리 가능 (Phase 4~5 고려)
- **Auto-suspend**: 5분 무활동 시 컴퓨트 자동 정지 → 비용 절감
- **Serverless**: 사용 안 하면 과금 안 됨

## 관련 문서

- [ADR 002](../08-decisions/002-neon-cloud-db.md)
- [benchmark-schema](../05-data-collection/benchmark-schema.md)
- [scaling-limits](scaling-limits.md)
- [local-dev](local-dev.md)
