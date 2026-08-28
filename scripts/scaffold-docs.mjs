#!/usr/bin/env node
// Scaffolds all placeholder docs and dev-agent files.
// Idempotent: skips existing files.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const TODAY = '2026-08-28';

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function write(relPath, content) {
  const full = resolve(ROOT, relPath);
  if (await exists(full)) {
    console.log(`  skip (exists): ${relPath}`);
    return;
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
  console.log(`  wrote: ${relPath}`);
}

function fm(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((s) => JSON.stringify(s)).join(', ')}]`);
    else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function placeholder(title, meta, extra = '') {
  return (
    fm({ ...meta, last_updated: TODAY, status: meta.status ?? 'draft' }) +
    `# ${title}\n\n_아직 미작성. 브레인스토밍 진행하며 채워짐._\n${extra}`
  );
}

const files = [];

// ==============================
// docs/INDEX.md
// ==============================
files.push([
  'docs/INDEX.md',
  `# Pinpoint-Threads Docs Index

프로젝트의 모든 설계·규칙·의사결정 문서 카탈로그. 어느 AI든 이 파일을 먼저 읽고 필요한 문서만 부분 로드하세요.

## 00-overview
- [vision](00-overview/vision.md) — 프로젝트 목적, 수익 모델, 성공 지표
- [glossary](00-overview/glossary.md) — 스하리, 쿠파스, CIB 등 용어 정의

## 01-pipelines
- [A-shopping](01-pipelines/A-shopping.md) — 쇼핑 콘텐츠 파이프라인 (커머스·수익화)
- [B-suhari](01-pipelines/B-suhari.md) — 스하리 파이프라인 (팔로워 부스팅)
- [C-daily](01-pipelines/C-daily.md) — 일상글 파이프라인 (엔게이지먼트)

## 02-architecture
- [tech-stack](02-architecture/tech-stack.md) — 확정 스택
- [state-machine](02-architecture/state-machine.md) — Post 상태 전이 규칙
- [data-flow](02-architecture/data-flow.md) — 파이프라인별 데이터 흐름도
- [folder-layout](02-architecture/folder-layout.md) — src 폴더 구조

## 03-infrastructure
- [local-dev](03-infrastructure/local-dev.md) — 로컬 부팅 가이드
- [database](03-infrastructure/database.md) — Neon Postgres + pgvector
- [deployment](03-infrastructure/deployment.md) — VPS 이전 계획
- [cost-model](03-infrastructure/cost-model.md) — 월 비용 예측

## 04-safety
- [account-isolation](04-safety/account-isolation.md) — 4개 계정 격리 규칙
- [cib-prevention](04-safety/cib-prevention.md) — Meta CIB 감지 회피
- [legal-compliance](04-safety/legal-compliance.md) — 공정위 문구·법적 규칙
- [rate-limits](04-safety/rate-limits.md) — 하드 캡·딜레이 정책

## 05-data-collection
- [strategy](05-data-collection/strategy.md) — 수집 대상별 방식 매트릭스
- [benchmark-schema](05-data-collection/benchmark-schema.md) — BenchmarkPost 스키마
- [rag-design](05-data-collection/rag-design.md) — 벡터 검색·Few-shot 설계
- [self-improvement](05-data-collection/self-improvement.md) — 발행 성과 회수 루프

## 06-accounts
- [personas](06-accounts/personas.md) — 4계정 페르소나 정의
- [schedules](06-accounts/schedules.md) — 계정별 활동 시간대
- [credentials](06-accounts/credentials.md) — 토큰 관리 (실제 값은 .env)

## 07-external-apis
- [threads](07-external-apis/threads.md) — Meta Threads Graph API
- [coupang](07-external-apis/coupang.md) — HMAC 서명·검색·딥링크
- [musinsa](07-external-apis/musinsa.md) — 큐레이터 API
- [telegram](07-external-apis/telegram.md) — grammY 봇·승인 UI
- [anthropic](07-external-apis/anthropic.md) — Claude 호출 정책

## 08-decisions (ADR)
- [001-static-copy-first](08-decisions/001-static-copy-first.md) — 정적 카피로 발행 시작
- [002-neon-cloud-db](08-decisions/002-neon-cloud-db.md) — 처음부터 Neon 클라우드 DB
- [003-twelve-module-catalog](08-decisions/003-twelve-module-catalog.md) — 12개 런타임 모듈로 축약
- [004-three-pipelines](08-decisions/004-three-pipelines.md) — 파이프라인 3개 (A/B/C)
- [005-rag-deferred](08-decisions/005-rag-deferred.md) — RAG는 데이터 임계량 후 자동 전환
- [006-doc-structure](08-decisions/006-doc-structure.md) — 인덱스 기반 분리 문서 구조

## 09-agents (런타임 모듈)
- [catalog](09-agents/catalog.md) — 12개 모듈 총람
### shared/ (파이프라인 공용)
- [source-collector](09-agents/shared/source-collector.md)
- [content-classifier](09-agents/shared/content-classifier.md)
- [copywriter](09-agents/shared/copywriter.md)
- [media-handler](09-agents/shared/media-handler.md)
- [publisher](09-agents/shared/publisher.md)
- [approval-gate](09-agents/shared/approval-gate.md)
- [performance-collector](09-agents/shared/performance-collector.md)
- [planner-auditor](09-agents/shared/planner-auditor.md)
### pipeline-a/ (쇼핑 전용)
- [product-matcher](09-agents/pipeline-a/product-matcher.md)
- [vision-verifier](09-agents/pipeline-a/vision-verifier.md)
- [reply-composer](09-agents/pipeline-a/reply-composer.md)
### pipeline-b/ (스하리 전용)
- [engagement-worker](09-agents/pipeline-b/engagement-worker.md)
`,
]);

// ==============================
// 00-overview
// ==============================
files.push([
  'docs/00-overview/vision.md',
  placeholder('프로젝트 비전 & 성공 지표', {
    title: '프로젝트 비전',
    tags: ['overview', 'business', 'goals'],
    related: ['A-shopping', 'B-suhari', 'C-daily'],
  }),
]);
files.push([
  'docs/00-overview/glossary.md',
  placeholder('용어 사전', {
    title: '용어 사전',
    tags: ['overview', 'glossary'],
    related: [],
  }, `
## 예정 정의
- 스하리, 맞스하리, 쿠파스, CIB, 딥링크, 스레드 그래프 API 등
`),
]);

// ==============================
// 01-pipelines
// ==============================
files.push([
  'docs/01-pipelines/A-shopping.md',
  placeholder('Pipeline A — 쇼핑 콘텐츠', {
    title: 'Pipeline A: 쇼핑 콘텐츠',
    tags: ['pipeline', 'commerce', 'coupang', 'musinsa', 'monetization'],
    related: ['B-suhari', 'C-daily', 'product-matcher', 'vision-verifier', 'copywriter', 'reply-composer'],
  }, `
## 예정 섹션
- 소스 수집 (해외 커머스 트렌드)
- AI 판정·분류·키워드 추출
- 상품 매칭 (채널 라우팅 쿠팡/무신사)
- Vision 정합성 Self-Correction Loop
- 페르소나 카피 (쿠파스 스타일)
- 대댓글 조립 (딥링크 + 공정위)
- Telegram 승인 → 발행
- 미디어 2개 이상 하드 룰
`),
]);
files.push([
  'docs/01-pipelines/B-suhari.md',
  placeholder('Pipeline B — 스하리', {
    title: 'Pipeline B: 스하리',
    tags: ['pipeline', 'engagement', 'suhari', 'follower-growth'],
    related: ['A-shopping', 'C-daily', 'engagement-worker', 'rate-limits'],
  }, `
## 예정 섹션
- 스하리 템플릿 풀 관리
- 해시태그 검색으로 반응 좋은 스하리 큐레이션
- 일 1회 발행
- 댓글 폴링 → 팔로우 검증 → 팔로우백 (3~5 하드 캡)
- 랜덤 지터 10~30분
`),
]);
files.push([
  'docs/01-pipelines/C-daily.md',
  placeholder('Pipeline C — 일상글', {
    title: 'Pipeline C: 일상글',
    tags: ['pipeline', 'engagement', 'daily-content', 'aggro'],
    related: ['A-shopping', 'B-suhari', 'copywriter'],
  }, `
## 예정 섹션
- 해외 일상 콘텐츠 트렌드 수집 (동물·밈·감동 등)
- 한국 정서 적합성 필터
- 문화 각색 (자막·설명 한국식)
- 미디어 2개 이상 하드 룰
- 수익화 없음, 순수 엔게이지먼트
`),
]);

// ==============================
// 02-architecture
// ==============================
files.push([
  'docs/02-architecture/tech-stack.md',
  placeholder('확정 기술 스택', {
    title: '확정 기술 스택',
    tags: ['architecture', 'tech-stack'],
    related: ['folder-layout', 'database'],
  }, `
## 확정 사항
- Language: TypeScript / Node.js 20+
- HTTP: Fastify
- Queue: BullMQ + Redis
- DB: PostgreSQL + Prisma + pgvector (Neon Cloud)
- Telegram Bot: grammY
- Scraping: Playwright (Phase 5+)
- Media Hosting: Cloudflare R2
- AI: Anthropic Claude Sonnet 5 (카피/Vision) + Haiku 4.5 (필터)
- Embedding: Voyage AI (RAG용, Phase 5+)
- Deployment: Docker Compose → Hetzner VPS (Phase 4+)
`),
]);
files.push([
  'docs/02-architecture/state-machine.md',
  placeholder('Post 상태 머신', {
    title: 'Post 상태 머신',
    tags: ['architecture', 'state-machine', 'post-lifecycle'],
    related: ['A-shopping', 'B-suhari', 'C-daily'],
  }, `
## 상태
- DRAFT, CLASSIFYING, MATCHING, COPYWRITING, PENDING_APPROVAL, APPROVED, PUBLISHING, PUBLISHED, REJECTED, FAILED

## 전이 규칙
src/state/post-state-machine.ts 참조
`),
]);
files.push([
  'docs/02-architecture/data-flow.md',
  placeholder('데이터 흐름도', {
    title: '데이터 흐름도',
    tags: ['architecture', 'data-flow', 'diagrams'],
    related: ['state-machine'],
  }),
]);
files.push([
  'docs/02-architecture/folder-layout.md',
  placeholder('src 폴더 구조', {
    title: 'src 폴더 구조',
    tags: ['architecture', 'folder-layout'],
    related: ['tech-stack'],
  }, `
## 현재 구조
- src/adapters/{anthropic,commerce,telegram,threads,media}
- src/config/{env,logger}
- src/db/prisma
- src/queues/{connection,queues}
- src/state/post-state-machine
- src/pipeline/workers
- src/services/approval-service
- src/{index,worker,bot}.ts
`),
]);

// ==============================
// 03-infrastructure
// ==============================
files.push([
  'docs/03-infrastructure/local-dev.md',
  placeholder('로컬 개발 부팅 가이드', {
    title: '로컬 개발 부팅',
    tags: ['infrastructure', 'local-dev'],
    related: ['database', 'deployment'],
  }),
]);
files.push([
  'docs/03-infrastructure/database.md',
  placeholder('DB 인프라 (Neon + pgvector)', {
    title: 'DB 인프라',
    tags: ['infrastructure', 'database', 'neon', 'pgvector'],
    related: ['tech-stack', 'benchmark-schema', 'rag-design'],
  }, `
## 확정
- Neon 클라우드 Postgres (처음부터, 로컬 개발도 이 DB 사용)
- pgvector 확장으로 임베딩 저장
- 로컬 Docker Postgres는 제거 예정
`),
]);
files.push([
  'docs/03-infrastructure/deployment.md',
  placeholder('배포 계획', {
    title: '배포 계획',
    tags: ['infrastructure', 'deployment', 'vps'],
    related: ['local-dev', 'cost-model'],
  }, `
## 로드맵
- 지금: 로컬 개발 (Windows Docker)
- Phase 4: Hetzner VPS 티어 1 ($6/월)
- 수익 검증 후: 티어 2 (프록시 도입)
- 스케일 후: 티어 3 (계정별 IP 분리)
`),
]);
files.push([
  'docs/03-infrastructure/cost-model.md',
  placeholder('월 비용 예측', {
    title: '월 비용 예측',
    tags: ['infrastructure', 'cost'],
    related: ['deployment'],
  }, `
## 티어별 예상
- 개발 단계: $5~20 (Anthropic API + Neon 무료)
- Phase 4 (티어 1): $15~35
- 티어 2: $30~60
- 티어 3: $100~200
`),
]);

// ==============================
// 04-safety
// ==============================
files.push([
  'docs/04-safety/account-isolation.md',
  placeholder('계정 격리 규칙', {
    title: '계정 격리 규칙',
    tags: ['safety', 'account-isolation'],
    related: ['cib-prevention', 'rate-limits', 'personas'],
  }, `
## 하드 룰
- 4개 자체 계정끼리 팔로우/스하리/맞팔 절대 금지
- 계정별 페르소나 완전 분리 (accountId를 seed로)
- 계정 간 최소 1~4h 랜덤 발행 시차
- 계정별 활동 시간대 프로필
`),
]);
files.push([
  'docs/04-safety/cib-prevention.md',
  placeholder('CIB 감지 회피', {
    title: 'CIB 감지 회피',
    tags: ['safety', 'cib', 'meta-policy'],
    related: ['account-isolation', 'rate-limits'],
  }),
]);
files.push([
  'docs/04-safety/legal-compliance.md',
  placeholder('법적 컴플라이언스', {
    title: '법적 컴플라이언스',
    tags: ['safety', 'legal', 'ftc'],
    related: ['A-shopping', 'reply-composer'],
  }, `
## 필수 문구
"이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."
`),
]);
files.push([
  'docs/04-safety/rate-limits.md',
  placeholder('Rate Limits & 하드 캡', {
    title: 'Rate Limits',
    tags: ['safety', 'rate-limits'],
    related: ['cib-prevention', 'engagement-worker'],
  }, `
## 하드 캡
- 스하리 팔로우백: 하루 3~5회 (랜덤), 초과 시 즉시 셧다운
- 계정별 발행 시차: 1~4h 랜덤
- 스하리 지터: 10~30분
- 상품 중복 방지: (account_id, product_id) 최근 14일
`),
]);

// ==============================
// 05-data-collection
// ==============================
files.push([
  'docs/05-data-collection/strategy.md',
  placeholder('데이터 수집 전략', {
    title: '데이터 수집 전략',
    tags: ['data-collection', 'scraping', 'apify', 'playwright'],
    related: ['rag-design', 'benchmark-schema'],
  }, `
## 3가지 대상
1. 소스 콘텐츠 (Pipeline A/C 원본) — 해외 트렌드
2. 벤치마크 콘텐츠 (RAG few-shot용) — 국내 반응 폭발 글
3. 내 계정 성과 (셀프 개선) — Threads Graph API

## 미결정
- 대상 1, 2의 수집 방식 (Apify vs 자체 Playwright vs 수동)
`),
]);
files.push([
  'docs/05-data-collection/benchmark-schema.md',
  placeholder('BenchmarkPost 스키마', {
    title: 'BenchmarkPost 스키마',
    tags: ['data-collection', 'schema', 'pgvector'],
    related: ['rag-design', 'database'],
  }),
]);
files.push([
  'docs/05-data-collection/rag-design.md',
  placeholder('RAG 설계', {
    title: 'RAG 설계',
    tags: ['data-collection', 'rag', 'vector-search'],
    related: ['benchmark-schema', 'copywriter'],
  }, `
## 핵심
- Voyage AI 임베딩 (multimodal, 텍스트+이미지)
- pgvector cosine similarity + engagement 가중치
- Top-K 5개 few-shot 주입
- 임계 데이터량 도달 시 정적 카피 → RAG 카피 자동 전환
`),
]);
files.push([
  'docs/05-data-collection/self-improvement.md',
  placeholder('셀프 개선 루프', {
    title: '셀프 개선 루프',
    tags: ['data-collection', 'self-improvement', 'threads-insights'],
    related: ['rag-design', 'performance-collector'],
  }),
]);

// ==============================
// 06-accounts
// ==============================
files.push([
  'docs/06-accounts/personas.md',
  placeholder('4계정 페르소나', {
    title: '4계정 페르소나',
    tags: ['accounts', 'personas'],
    related: ['account-isolation', 'copywriter'],
  }, `
## 미정
사용자님이 각 계정의 톤·타깃·활동 시간대 정의 예정
`),
]);
files.push([
  'docs/06-accounts/schedules.md',
  placeholder('계정별 활동 시간대', {
    title: '계정별 활동 시간대',
    tags: ['accounts', 'schedules'],
    related: ['personas', 'rate-limits', 'planner-auditor'],
  }),
]);
files.push([
  'docs/06-accounts/credentials.md',
  placeholder('토큰 관리', {
    title: '토큰 관리',
    tags: ['accounts', 'credentials', 'security'],
    related: ['threads'],
  }, `
## 원칙
- 실제 토큰은 .env / DB에만 (문서에 절대 금지)
- Long-lived Access Token 60일 만료 → 자동 갱신 워커
`),
]);

// ==============================
// 07-external-apis
// ==============================
for (const [name, tags, related] of [
  ['threads', ['api', 'threads', 'meta'], ['credentials', 'publisher']],
  ['coupang', ['api', 'coupang', 'hmac'], ['product-matcher', 'A-shopping']],
  ['musinsa', ['api', 'musinsa'], ['product-matcher', 'A-shopping']],
  ['telegram', ['api', 'telegram', 'grammy'], ['approval-gate']],
  ['anthropic', ['api', 'anthropic', 'claude'], ['copywriter', 'content-classifier', 'vision-verifier']],
]) {
  files.push([
    `docs/07-external-apis/${name}.md`,
    placeholder(`${name} API`, {
      title: `${name} API`,
      tags,
      related,
    }),
  ]);
}

// ==============================
// 08-decisions (ADR)
// ==============================
files.push([
  'docs/08-decisions/001-static-copy-first.md',
  `---
title: "ADR 001: 정적 카피로 발행 시작"
tags: ["adr", "copywriter", "rag"]
date: "${TODAY}"
status: "accepted"
---

# ADR 001: 정적 카피 우선, RAG는 데이터 임계량 후 자동 전환

## 상태
Accepted

## 컨텍스트
카피 생성 방식으로 (1) 정적 프롬프트, (2) RAG few-shot, (3) 하이브리드 3가지 옵션.
RAG는 데이터 수집·임베딩 인프라 구축이 선행되어야 하는데, 발행 시작을 미룰 이유는 없음.

## 결정
- Launch 초기는 정적 프롬프트 (쿠파스 게시글 생성기 스타일 이식)
- 데이터는 처음부터 수집·임베딩해 축적
- 임계량(예: 벤치마크 500건) 도달 시 카피 생성이 자동으로 RAG few-shot 모드로 전환

## 결과
- Phase 4 발행 시작이 데이터 수집에 블록되지 않음
- RAG는 quality 최적화 트랙으로 병행
`,
]);

files.push([
  'docs/08-decisions/002-neon-cloud-db.md',
  `---
title: "ADR 002: Neon 클라우드 Postgres 처음부터 도입"
tags: ["adr", "database", "infrastructure"]
date: "${TODAY}"
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
`,
]);

files.push([
  'docs/08-decisions/003-twelve-module-catalog.md',
  `---
title: "ADR 003: 런타임 모듈 12개로 축약"
tags: ["adr", "architecture", "agents"]
date: "${TODAY}"
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
`,
]);

files.push([
  'docs/08-decisions/004-three-pipelines.md',
  `---
title: "ADR 004: 파이프라인 3개 구조 (A/B/C)"
tags: ["adr", "pipelines", "architecture"]
date: "${TODAY}"
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
`,
]);

files.push([
  'docs/08-decisions/005-rag-deferred.md',
  `---
title: "ADR 005: RAG 도입 시점 - 데이터 임계량 후 자동 전환"
tags: ["adr", "rag", "data-collection"]
date: "${TODAY}"
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
`,
]);

files.push([
  'docs/08-decisions/006-doc-structure.md',
  `---
title: "ADR 006: 인덱스 기반 분리 문서 구조"
tags: ["adr", "docs", "workflow"]
date: "${TODAY}"
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
`,
]);

// ==============================
// 09-agents
// ==============================
files.push([
  'docs/09-agents/catalog.md',
  placeholder('런타임 모듈 12개 총람', {
    title: '런타임 모듈 카탈로그',
    tags: ['agents', 'modules', 'runtime'],
    related: ['A-shopping', 'B-suhari', 'C-daily'],
  }, `
## 12개 모듈
### shared/
1. source-collector
2. content-classifier (AI: Haiku)
3. copywriter (AI: Sonnet)
4. media-handler
5. publisher
6. approval-gate
7. performance-collector
8. planner-auditor

### pipeline-a/
9. product-matcher
10. vision-verifier (AI: Sonnet Vision)
11. reply-composer

### pipeline-b/
12. engagement-worker
`),
]);

const agentModules = [
  ['shared/source-collector', ['A', 'C'], 'none', ['strategy']],
  ['shared/content-classifier', ['A', 'C'], 'claude-haiku-4-5', ['A-shopping', 'C-daily']],
  ['shared/copywriter', ['A', 'B', 'C'], 'claude-sonnet-5', ['A-shopping', 'B-suhari', 'C-daily', 'personas', 'rag-design']],
  ['shared/media-handler', ['A', 'C'], 'none', ['A-shopping', 'C-daily']],
  ['shared/publisher', ['A', 'B', 'C'], 'none', ['threads']],
  ['shared/approval-gate', ['A', 'B', 'C'], 'none', ['telegram']],
  ['shared/performance-collector', ['A', 'B', 'C'], 'none', ['self-improvement', 'threads']],
  ['shared/planner-auditor', ['A', 'B', 'C'], 'none', ['schedules', 'rate-limits', 'cib-prevention']],
  ['pipeline-a/product-matcher', ['A'], 'none', ['coupang', 'musinsa']],
  ['pipeline-a/vision-verifier', ['A'], 'claude-sonnet-5', ['A-shopping', 'anthropic']],
  ['pipeline-a/reply-composer', ['A'], 'none', ['legal-compliance']],
  ['pipeline-b/engagement-worker', ['B'], 'none', ['B-suhari', 'rate-limits']],
];

for (const [path, pipelines, ai, related] of agentModules) {
  const name = path.split('/').pop();
  files.push([
    `docs/09-agents/${path}.md`,
    `---
title: ${JSON.stringify(name)}
pipelines: [${pipelines.map((p) => `"${p}"`).join(', ')}]
ai_model: ${JSON.stringify(ai)}
tags: ["agent", "runtime-module"]
related: [${related.map((r) => `"${r}"`).join(', ')}]
last_updated: "${TODAY}"
status: "draft"
---

# ${name}

_아직 미작성. 브레인스토밍 진행하며 채워짐._

## 목적
## 입력 스펙
## 출력 스펙
## 프롬프트 or 로직
## 실패 모드 & 폴백
## 재시도 정책
## 관찰 지표
`,
  ]);
}

// ==============================
// .claude/agents (개발용 커스텀 서브에이전트)
// ==============================
const devAgents = [
  {
    name: 'threads-api-expert',
    description: 'Meta Threads Graph API 전문가. OAuth 흐름, 2-step container publish, reply by parent_id, insights, rate limit 처리에 특화. Publisher와 Performance Collector 개발 시 사용.',
    tools: 'Read, Grep, Glob, WebFetch, WebSearch',
  },
  {
    name: 'commerce-partners-expert',
    description: '쿠팡 파트너스 HMAC-SHA256 서명, Search·Deeplink API, 무신사 큐레이터 API 전문가. Product Matcher 개발 시 사용.',
    tools: 'Read, Grep, Glob, WebFetch, WebSearch',
  },
  {
    name: 'prompt-engineer',
    description: 'Anthropic Claude 프롬프트 튜닝 전문가. 페르소나 이식, Few-shot 설계, 출력 스키마 검증, 실측 A/B 비교 설계. Copywriter·Classifier·Vision Verifier 개발 시 사용.',
    tools: 'Read, Edit, Write, Grep, Bash',
  },
  {
    name: 'playwright-scraper-expert',
    description: 'Playwright 스크래핑 전문가. Threads·해외 사이트 스크래핑, 안티봇 회피, 셀렉터 유지 전략, 프록시 통합. Source Collector 개발 시 (Phase 5+) 사용.',
    tools: 'Read, Edit, Write, Grep, Bash, WebFetch',
  },
  {
    name: 'safety-auditor-dev',
    description: 'CIB 감지 시나리오 검증, 계정 격리 규칙 실측, Rate Limit·하드 캡 정책 검토 전문가. Safety 모듈 개발 시 사용.',
    tools: 'Read, Grep, Glob, Edit',
  },
];

for (const a of devAgents) {
  files.push([
    `.claude/agents/${a.name}.md`,
    `---
name: ${a.name}
description: ${a.description}
tools: ${a.tools}
---

# ${a.name}

이 서브에이전트는 Pinpoint-Threads 프로젝트에서 다음 영역에 특화된 조력자입니다.

## 전문 영역
${a.description}

## 참조 문서
작업 시작 전 \`docs/INDEX.md\`를 열어 관련 문서를 찾고 로드하세요.

## 원칙
- 실제 API 명세는 공식 문서를 우선 (WebFetch)
- 프로젝트 규칙은 \`CLAUDE.md\`와 \`docs/04-safety/\` 우선
- 미구현 스텁을 그대로 두지 말고 실제 로직으로 채우기
- 실측 검증 없이 "완료" 선언 금지 (verification-before-completion 원칙)
`,
  ]);
}

// ==============================
// CLAUDE.md (재작성 - lightweight)
// ==============================
files.push([
  'CLAUDE.md',
  `# Pinpoint-Threads

Threads 커머스·엔게이지먼트 자동화 파이프라인.

## 이 문서

이 파일은 최소 정체성만 담습니다. 상세 규칙과 설계는 \`docs/\`에.

**어떤 작업이든 시작 전에 반드시:**
1. \`docs/INDEX.md\` 를 열어 관련 문서를 찾는다.
2. 해당 문서와 그 문서의 \`related:\` 프론트매터에 명시된 파일들을 로드한다.

## 최소 규칙 (읽지 않고 위반하면 안 됨)

- 본문에 쿠팡/무신사 링크 절대 금지 (대댓글 또는 프로필로만)
- 계정 간 최소 1~4h 랜덤 시차, 동시 발행 금지
- 스하리 팔로우백 하루 3~5회 하드 캡, 초과 시 즉시 셧다운
- 공정위 필수 문구 대댓글에 반드시 포함
- 4개 자체 계정끼리 팔로우/스하리/맞팔 절대 금지
- 미디어는 쇼핑·일상글에서 반드시 2개 이상
- 상품 중복 노출: 계정별 14일 이내 동일 상품 금지

## 프로젝트 개관

- 3개 파이프라인: A(쇼핑·수익화), B(스하리·팔로워부스팅), C(일상글·엔게이지먼트)
- 12개 런타임 모듈: [docs/09-agents/catalog.md](docs/09-agents/catalog.md)
- 스택: TypeScript / Node.js / Fastify / BullMQ / Prisma / Neon Postgres / grammY / Anthropic Claude
- 인프라: 로컬 개발 → Phase 4 Hetzner VPS 이전
- 카피 전략: 정적 프롬프트 launch → 데이터 임계량 도달 후 RAG 자동 전환

## 프로젝트 상태

- Phase: 2 (API 어댑터 구현 중)
- Meta Threads API 승인: 대기 중
- 파이프라인 진행률: A(설계 확정), B(설계), C(설계)

## 커스텀 서브에이전트

프로젝트 전용 도메인 전문가는 \`.claude/agents/\`에:
- \`threads-api-expert\`, \`commerce-partners-expert\`, \`prompt-engineer\`, \`playwright-scraper-expert\`, \`safety-auditor-dev\`
`,
]);

// ==============================
// AGENTS.md (미러)
// ==============================
files.push([
  'AGENTS.md',
  `# Pinpoint-Threads Project Guide (for AI collaborators)

This file mirrors CLAUDE.md so that any AI collaborator (GPT, Gemini, Codex, etc.) can understand this project's rules.

## 반드시 먼저 읽을 것

1. \`docs/INDEX.md\` — 전체 문서 카탈로그
2. 관련 문서의 \`related:\` 프론트매터를 따라 필요한 것만 로드

## Hard Rules

- 본문에 쿠팡/무신사 링크 절대 금지 (대댓글 또는 프로필로만)
- 계정 간 최소 1~4h 랜덤 시차, 동시 발행 금지
- 스하리 팔로우백 하루 3~5회 하드 캡
- 공정위 필수 문구 대댓글에 반드시 포함
- 4개 자체 계정끼리 팔로우/스하리/맞팔 절대 금지
- 미디어는 쇼핑·일상글에서 반드시 2개 이상
- 상품 중복 노출: 계정별 14일 이내 동일 상품 금지

## Architecture Snapshot

- 3 pipelines: A (shopping/monetization), B (suhari/growth), C (daily/engagement)
- 12 runtime modules cataloged in \`docs/09-agents/catalog.md\`
- Stack: TypeScript / Node.js / Fastify / BullMQ / Prisma / Neon Postgres / grammY / Anthropic Claude
- Copy strategy: static prompt at launch → auto-switch to RAG when benchmark data threshold met
`,
]);

// ==============================
// 실행
// ==============================
console.log(`Scaffolding ${files.length} files...`);
for (const [path, content] of files) {
  await write(path, content);
}
console.log('Done.');
