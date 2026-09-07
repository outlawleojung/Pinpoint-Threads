# Pipeline D — 네이버 블로그 쇼핑커넥트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쇼핑커넥트 성과형 제휴 상품을 받아 SEO 최적화 네이버 블로그 원고 + 이미지 패키지를 생성하고, 사용자가 복붙 발행할 수 있게 Admin 발행 페이지로 전달하는 별개 파이프라인(D)을 구축한다.

**Architecture:** 상품우선(product-first) 흐름. 사용자가 텔레그램 `/naver <쇼핑커넥트 링크>` 전송 → 링크 해석 → 쇼핑검색 API로 상품 데이터 보강 → 공식 상품 이미지 + Gemini 보조 이미지 확보 → Sonnet이 SEO 스키마대로 원고 생성 → `NaverPost` 저장 → 텔레그램 알림 + Admin "발행 페이지"(블록 복사 + 이미지 삽입 가이드). **자동 발행 없음(API 폐지 + 계정 리스크). 발행은 사용자 수동 복붙.**

**Tech Stack:** TypeScript / Node 20 / Fastify / grammY / Prisma(Neon Postgres) / `@google/genai`(이미지) / `@anthropic-ai/sdk`(원고, LLM 추상화 경유) / Cloudinary / Playwright(상세페이지 폴백) / Zod.

**Spec:** [docs/superpowers/specs/2026-09-06-naver-blog-shopping-connect-design.md](../specs/2026-09-06-naver-blog-shopping-connect-design.md)

## Global Constraints

- **자동 발행 금지**: 네이버 블로그 글쓰기 API는 2020년 폐지. 브라우저 자동 로그인/발행도 금지(계정 정지 리스크·CLAUDE.md 자동화 금지). 산출물은 "복붙 패키지"까지만.
- **공정위 문구 필수**: 원고 본문 내 **첫 제휴 링크가 나오기 전** 위치에 제휴 안내 문구 삽입. 문구는 `NAVER_LEGAL_DISCLAIMER` 상수 하나로 관리.
- **AI 이미지 도배 금지**: 상품 실물 사진은 공식 이미지(자동 취득)만. Gemini 생성 이미지는 보조(썸네일·그래픽)로 한 편당 비중 제한(기본 상한 3장). 상품 실물을 AI로 생성하지 않는다.
- **정보성 : 제휴 = 7 : 3**: `NaverPost.kind` = `INFO` | `AFFILIATE`. 최근 발행 비율이 제휴 30% 초과면 다음 제휴 요청 시 경고.
- **1 블로그 = 1 주제**: 주제군은 `NaverBlogConfig.topic` 단일 값. 원고 주제 일관성 프롬프트 제약으로 사용.
- **테스트 관례**: 이 저장소엔 유닛 테스트 러너가 없다. 검증은 `scripts/naver/*.ts`(tsx 실행) + `pnpm typecheck`로 한다. 순수 함수는 스크립트 내 `assert`로, 외부 API 호출부는 실 호출 결과 출력(실측 검증)으로 확인한다. 각 태스크의 "테스트" 단계는 이 관례를 따른다.
- **패키지 매니저**: `pnpm`. 스크립트 실행은 `pnpm tsx scripts/naver/<file>.ts` 또는 `pnpm exec tsx ...`.
- **ESM 경로**: 상대 import는 `.js` 확장자를 붙인다(기존 코드 관례, `moduleResolution` NodeNext).

---

## File Structure

**신규 파일**
- `prisma/schema.prisma` (수정) — `NaverProduct`, `NaverPost` 모델 + `NaverPostState`, `NaverPostKind` enum + `NaverBlogConfig` 모델
- `src/infra/commerce/naver-shopping-client.ts` — 네이버 쇼핑검색 API 어댑터(`CommerceAdapter` 구현)
- `src/infra/naver/shopping-connect-link.ts` — 쇼핑커넥트/스마트스토어 링크 → productId·상품명 파서(순수 함수)
- `src/infra/naver/smartstore-detail.ts` — 상세페이지 고화질 이미지 Playwright 폴백 취득
- `src/infra/llm/gemini-image.ts` — Gemini(Nano Banana) 이미지 생성 → Buffer
- `src/modules/pipeline-d/naver-copywriter/index.ts` — SEO 스키마 원고 생성(Sonnet)
- `src/modules/pipeline-d/naver-copywriter/schema.ts` — `NaverPostDraft` Zod 스키마 + 타입
- `src/modules/pipeline-d/publish-package/index.ts` — 블록 구조 복붙 패키지 렌더러(순수 함수)
- `src/modules/pipeline-d/post-builder/index.ts` — 오케스트레이터 + 7:3 비율 판정
- `src/modules/shared/admin/naver-routes.ts` — Admin 발행 목록·상세 페이지
- `scripts/naver/*.ts` — 태스크별 검증 스크립트

**수정 파일**
- `src/index.ts` — `registerNaverRoutes(app)` 등록
- `src/modules/shared/approval-gate/bot.ts` — `/naver` 커맨드 추가
- `src/config/env.ts` — `GEMINI_MODEL_IMAGE` 추가(이미지 모델명)

---

## Task 1: Prisma 모델 (NaverProduct · NaverPost · NaverBlogConfig)

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `scripts/naver/verify-schema.ts`

**Interfaces:**
- Produces: Prisma 모델 `NaverProduct`, `NaverPost`, `NaverBlogConfig`; enum `NaverPostState { DRAFT PLANNED READY PUBLISHED }`, `NaverPostKind { INFO AFFILIATE }`. `NaverPost` 주요 필드: `id`, `state`, `kind`, `title`, `draftJson Json`(NaverPostDraft 직렬화), `productId String?`, `product NaverProduct?`, `imageUrls String[]`, `connectUrl String?`, `topic String`, `telegramNotifiedAt DateTime?`, `publishedAt DateTime?`, `createdAt`, `updatedAt`. `NaverProduct`: `id`, `externalId`, `productName`, `productUrl`, `connectUrl`, `thumbnailUrl`, `price Int?`, `specsJson Json?`, `imageUrls String[]`, `createdAt`. (channel 필드 없음 — 단일 채널이라 불필요, Task 1 리뷰 ruling.) `NaverBlogConfig`: `id`, `topic String`, `cadencePerWeek Int @default(4)`, `affiliateRatio Float @default(0.3)`, singleton(하나만 사용).

- [ ] **Step 1: 스키마에 모델 추가**

`prisma/schema.prisma` 끝에 추가:

```prisma
enum NaverPostState {
  DRAFT      // 생성 직후
  PLANNED    // 원고 생성 완료, 승인 대기
  READY      // 승인됨, 발행 페이지 준비
  PUBLISHED  // 사용자가 수동 발행 완료로 표시
}

enum NaverPostKind {
  INFO       // 순수 정보성 (7)
  AFFILIATE  // 제휴 상품 (3)
}

model NaverBlogConfig {
  id             String  @id @default(cuid())
  topic          String                       // 1블로그 1주제군 (예: "뷰티·생활템")
  cadencePerWeek Int     @default(4)
  affiliateRatio Float   @default(0.3)         // 제휴 글 목표 비율 상한
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model NaverProduct {
  id           String   @id @default(cuid())
  externalId   String                          // 쇼핑검색 productId
  productName  String
  productUrl   String                          // 스마트스토어 canonical URL
  connectUrl   String                          // 사용자 제공 쇼핑커넥트 제휴 링크
  thumbnailUrl String?
  price        Int?
  specsJson    Json?                           // 스펙·경쟁제품 보강 데이터
  imageUrls    String[]                        // 공식 상품 이미지(자동 취득)
  createdAt    DateTime @default(now())
  naverPosts   NaverPost[]

  @@index([externalId])
}

model NaverPost {
  id                 String         @id @default(cuid())
  state              NaverPostState @default(DRAFT)
  kind               NaverPostKind  @default(AFFILIATE)
  topic              String
  title              String?
  draftJson          Json?                        // NaverPostDraft 직렬화
  connectUrl         String?
  imageUrls          String[]                     // 공식 + Gemini 보조 (순서 = 삽입 순서)
  productId          String?
  product            NaverProduct?  @relation(fields: [productId], references: [id])
  telegramNotifiedAt DateTime?
  approvedAt         DateTime?
  publishedAt        DateTime?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt

  @@index([state])
  @@index([kind, createdAt])
}
```

- [ ] **Step 2: 마이그레이션 생성·적용**

Run: `pnpm prisma migrate dev --name add-naver-pipeline`
Expected: 마이그레이션 파일 생성 + Neon 적용 성공, `prisma generate` 자동 실행.

- [ ] **Step 3: 검증 스크립트 작성**

`scripts/naver/verify-schema.ts`:

```ts
import { prisma } from '../../src/db/prisma.js';

async function main() {
  const cfg = await prisma.naverBlogConfig.create({ data: { topic: '뷰티·생활템' } });
  const product = await prisma.naverProduct.create({
    data: {
      externalId: 'test-1', productName: '테스트 상품', productUrl: 'https://smartstore.naver.com/x/products/1',
      connectUrl: 'https://naver.me/x', imageUrls: [],
    },
  });
  const post = await prisma.naverPost.create({
    data: { topic: cfg.topic, kind: 'AFFILIATE', productId: product.id, imageUrls: [] },
  });
  console.log('created', { cfg: cfg.id, product: product.id, post: post.id, state: post.state });
  // cleanup
  await prisma.naverPost.delete({ where: { id: post.id } });
  await prisma.naverProduct.delete({ where: { id: product.id } });
  await prisma.naverBlogConfig.delete({ where: { id: cfg.id } });
  console.log('OK: naver schema roundtrip + cleanup');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: 실행해 통과 확인**

Run: `pnpm tsx scripts/naver/verify-schema.ts`
Expected: `OK: naver schema roundtrip + cleanup` 출력, exit 0.

- [ ] **Step 5: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations scripts/naver/verify-schema.ts
git commit -m "feat(naver): NaverPost/NaverProduct/NaverBlogConfig 스키마 + 마이그레이션"
```

---

## Task 2: 쇼핑커넥트/스마트스토어 링크 파서 (순수 함수)

**Files:**
- Create: `src/infra/naver/shopping-connect-link.ts`
- Test: `scripts/naver/verify-link.ts`

**Interfaces:**
- Produces: `parseShoppingConnectLink(input: string): { productId: string | null; productUrl: string | null; connectUrl: string }`. `connectUrl`은 입력 원문 URL. 스마트스토어 canonical(`https://smartstore.naver.com/<store>/products/<id>`)이면 `productId`·`productUrl` 채움. 축약(`naver.me`)·트래킹 링크면 `productId=null, productUrl=null`(런타임에 리다이렉트 해석 필요 → Task 3에서 처리).

- [ ] **Step 1: 검증 스크립트 먼저 작성 (실패 확인용)**

`scripts/naver/verify-link.ts`:

```ts
import assert from 'node:assert';
import { parseShoppingConnectLink } from '../../src/infra/naver/shopping-connect-link.js';

// canonical smartstore
const a = parseShoppingConnectLink('https://smartstore.naver.com/myshop/products/1234567890?query=1');
assert.equal(a.productId, '1234567890');
assert.equal(a.productUrl, 'https://smartstore.naver.com/myshop/products/1234567890');
assert.equal(a.connectUrl, 'https://smartstore.naver.com/myshop/products/1234567890?query=1');

// brand store 형식
const b = parseShoppingConnectLink('https://brand.naver.com/somebrand/products/987654321');
assert.equal(b.productId, '987654321');

// 축약 링크 → productId 미확정
const c = parseShoppingConnectLink('https://naver.me/abcd1234');
assert.equal(c.productId, null);
assert.equal(c.connectUrl, 'https://naver.me/abcd1234');

console.log('OK: link parser');
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-link.ts`
Expected: FAIL — `Cannot find module ... shopping-connect-link.js` (아직 미구현).

- [ ] **Step 3: 구현**

`src/infra/naver/shopping-connect-link.ts`:

```ts
export interface ParsedConnectLink {
  productId: string | null;
  productUrl: string | null;
  connectUrl: string;
}

// smartstore.naver.com/<store>/products/<id> · brand.naver.com/<store>/products/<id>
const SMARTSTORE_RE = /^https?:\/\/(?:smartstore|brand)\.naver\.com\/[^/]+\/products\/(\d+)/i;

export function parseShoppingConnectLink(input: string): ParsedConnectLink {
  const connectUrl = input.trim();
  const m = connectUrl.match(SMARTSTORE_RE);
  if (m) {
    const productId = m[1]!;
    const base = connectUrl.split('?')[0]!;
    return { productId, productUrl: base, connectUrl };
  }
  return { productId: null, productUrl: null, connectUrl };
}
```

- [ ] **Step 4: 실행해 통과 확인**

Run: `pnpm tsx scripts/naver/verify-link.ts`
Expected: `OK: link parser`.

- [ ] **Step 5: 커밋**

```bash
git add src/infra/naver/shopping-connect-link.ts scripts/naver/verify-link.ts
git commit -m "feat(naver): 쇼핑커넥트/스마트스토어 링크 파서"
```

---

## Task 3: 네이버 쇼핑검색 API 어댑터

**Files:**
- Create: `src/infra/commerce/naver-shopping-client.ts`
- Test: `scripts/naver/verify-shopping-search.ts`

**Interfaces:**
- Consumes: `env.NAVER_CLIENT_ID`, `env.NAVER_CLIENT_SECRET`. `CommerceAdapter`/`CommerceSearchResult` from `./types.js`.
- Produces: `class NaverShoppingAdapter implements CommerceAdapter`. `channel = 'NAVER'`. `search(keyword, {limit})` → `CommerceSearchResult[]`(쇼핑검색 API `/v1/search/shop.json`). `generateDeeplink(url)` → 지원 안 함(쇼핑커넥트 링크는 사용자 제공) → 입력 url 그대로 반환. 추가: `searchByName(name): Promise<CommerceSearchResult | null>`(top-1 편의).

- [ ] **Step 1: 검증 스크립트 먼저 작성**

`scripts/naver/verify-shopping-search.ts`:

```ts
import { NaverShoppingAdapter } from '../../src/infra/commerce/naver-shopping-client.js';
import { env } from '../../src/config/env.js';

async function main() {
  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
    console.error('SKIP: NAVER_CLIENT_ID/SECRET 미설정 — .env 설정 후 재실행');
    process.exit(2);
  }
  const adapter = new NaverShoppingAdapter(env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET);
  const results = await adapter.search('무선 가습기', { limit: 3 });
  console.log('count', results.length);
  console.log(results.map((r) => ({ name: r.productName.slice(0, 30), price: r.price, id: r.externalId })));
  if (results.length === 0) throw new Error('빈 결과 — 쿼리/키 확인');
  console.log('OK: naver shopping search (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-shopping-search.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현 (coupang-client 패턴 준용)**

`src/infra/commerce/naver-shopping-client.ts`:

```ts
import type { CommerceAdapter, CommerceSearchResult } from './types.js';

const BASE_URL = 'https://openapi.naver.com/v1/search/shop.json';

interface NaverShopItem {
  title: string;        // <b> 태그 포함될 수 있음
  link: string;
  image: string;
  lprice: string;
  productId: string;
  brand?: string;
  maker?: string;
  category1?: string;
}
interface NaverShopResponse { items: NaverShopItem[] }

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

export class NaverShoppingAdapter implements CommerceAdapter {
  readonly channel = 'NAVER' as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private assert(): void {
    if (!this.clientId || !this.clientSecret) {
      throw new NaverShoppingConfigError('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET not set in .env');
    }
  }

  async search(keyword: string, opts?: { limit?: number }): Promise<CommerceSearchResult[]> {
    this.assert();
    const display = Math.min(opts?.limit ?? 5, 10);
    const url = `${BASE_URL}?query=${encodeURIComponent(keyword)}&display=${display}&sort=sim`;
    const resp = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': this.clientId,
        'X-Naver-Client-Secret': this.clientSecret,
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new NaverShoppingApiError(`shop search HTTP ${resp.status}: ${body.slice(0, 500)}`);
    }
    const json = (await resp.json()) as NaverShopResponse;
    return (json.items ?? []).map((it) => ({
      channel: 'NAVER' as const,
      externalId: it.productId,
      productName: stripTags(it.title),
      productUrl: it.link,
      thumbnailUrl: it.image,
      price: Number(it.lprice) || undefined,
      category: it.category1,
    }));
  }

  async searchByName(name: string): Promise<CommerceSearchResult | null> {
    const rows = await this.search(name, { limit: 1 });
    return rows[0] ?? null;
  }

  // 쇼핑커넥트 제휴 링크는 사용자가 발급·제공하므로 deeplink 생성 개념 없음. 입력 그대로 반환.
  async generateDeeplink(productUrl: string): Promise<string> {
    return productUrl;
  }
}

export class NaverShoppingApiError extends Error {
  constructor(message: string) { super(message); this.name = 'NaverShoppingApiError'; }
}
export class NaverShoppingConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'NaverShoppingConfigError'; }
}
```

- [ ] **Step 4: 실행해 통과 확인 (실측)**

Run: `pnpm tsx scripts/naver/verify-shopping-search.ts`
Expected: `OK: naver shopping search (실측)` + 상품 3건 출력. (키 미설정이면 exit 2 SKIP — 사용자에게 `.env` 설정 요청.)

- [ ] **Step 5: 커밋**

```bash
git add src/infra/commerce/naver-shopping-client.ts scripts/naver/verify-shopping-search.ts
git commit -m "feat(naver): 쇼핑검색 API 어댑터 (CommerceAdapter)"
```

---

## Task 4: 스마트스토어 상세 이미지 폴백 취득 (Playwright)

**Files:**
- Create: `src/infra/naver/smartstore-detail.ts`
- Test: `scripts/naver/verify-detail.ts`

**Interfaces:**
- Consumes: `parseShoppingConnectLink`(Task 2) — 축약 링크 해석 시 최종 URL 필요.
- Produces: `resolveConnectUrl(connectUrl: string): Promise<string>`(축약/트래킹 링크 → 최종 스마트스토어 URL, HTTP 리다이렉트 추적). `fetchProductImages(productUrl: string, opts?: { max?: number }): Promise<string[]>`(상세페이지 대표·상세 이미지 URL 배열, 실패 시 빈 배열). Playwright 익명 헤드리스(로그인 없음).

- [ ] **Step 1: 검증 스크립트 먼저 작성**

`scripts/naver/verify-detail.ts`:

```ts
import { resolveConnectUrl, fetchProductImages } from '../../src/infra/naver/smartstore-detail.js';

async function main() {
  const url = process.argv[2];
  if (!url) { console.error('사용법: pnpm tsx scripts/naver/verify-detail.ts <쇼핑커넥트/상품 URL>'); process.exit(2); }
  const resolved = await resolveConnectUrl(url);
  console.log('resolved', resolved);
  const imgs = await fetchProductImages(resolved, { max: 5 });
  console.log('images', imgs.length, imgs.slice(0, 3));
  console.log('OK: smartstore detail (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-detail.ts https://smartstore.naver.com/x/products/1`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/infra/naver/smartstore-detail.ts`:

```ts
import { chromium } from 'playwright';
import { logger } from '../../config/logger.js';

/** 축약/트래킹 링크 → 최종 URL (리다이렉트 추적, HEAD 우선 GET 폴백). */
export async function resolveConnectUrl(connectUrl: string): Promise<string> {
  try {
    const resp = await fetch(connectUrl, { redirect: 'follow', method: 'GET' });
    return resp.url || connectUrl;
  } catch (err) {
    logger.warn({ err: (err as Error).message, connectUrl }, 'resolveConnectUrl 실패, 원본 사용');
    return connectUrl;
  }
}

/** 상세페이지 대표/상세 이미지 URL 취득. 실패 시 빈 배열(호출측이 쇼핑검색 썸네일로 폴백). */
export async function fetchProductImages(productUrl: string, opts?: { max?: number }): Promise<string[]> {
  const max = opts?.max ?? 8;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    // 스마트스토어 상품 이미지: pstatic.net 도메인 img src 수집.
    const urls = await page.evaluate(() => {
      const set = new Set<string>();
      document.querySelectorAll('img').forEach((img) => {
        const src = (img as HTMLImageElement).src;
        if (src && /pstatic\.net|phinf|shop-phinf/.test(src)) set.add(src.split('?')[0]!);
      });
      return Array.from(set);
    });
    return urls.slice(0, max);
  } catch (err) {
    logger.warn({ err: (err as Error).message, productUrl }, 'fetchProductImages 실패');
    return [];
  } finally {
    await browser?.close();
  }
}
```

- [ ] **Step 4: 실행해 통과 확인 (실 상품 URL로)**

Run: `pnpm tsx scripts/naver/verify-detail.ts <사용자 제공 실제 상품 URL>`
Expected: `resolved` 최종 URL + `images` 1건 이상. (0건이면 셀렉터 조정 필요 — `logger.warn` 확인. 폴백 경로가 있으므로 파이프라인은 진행 가능.)

- [ ] **Step 5: 커밋**

```bash
git add src/infra/naver/smartstore-detail.ts scripts/naver/verify-detail.ts
git commit -m "feat(naver): 스마트스토어 링크 해석 + 상세 이미지 Playwright 폴백"
```

---

## Task 5: Gemini 이미지 생성 어댑터

**Files:**
- Create: `src/infra/llm/gemini-image.ts`
- Modify: `src/config/env.ts` (add `GEMINI_MODEL_IMAGE`)
- Test: `scripts/naver/verify-gemini-image.ts`

**Interfaces:**
- Consumes: `env.GEMINI_API_KEY`, `env.GEMINI_MODEL_IMAGE`.
- Produces: `generateImage(prompt: string): Promise<{ mimeType: string; data: Buffer }>` — 단일 보조 이미지 생성. 모델은 이미지 출력 지원 모델(`env.GEMINI_MODEL_IMAGE`, 기본 `gemini-2.5-flash-image`). 응답의 inlineData(base64) → Buffer.

- [ ] **Step 1: env에 이미지 모델 추가**

`src/config/env.ts`의 `GEMINI_MODEL_FAST` 줄 아래에 추가:

```ts
  GEMINI_MODEL_IMAGE: z.string().default('gemini-2.5-flash-image'),
```

- [ ] **Step 2: 검증 스크립트 먼저 작성**

`scripts/naver/verify-gemini-image.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { generateImage } from '../../src/infra/llm/gemini-image.js';
import { env } from '../../src/config/env.js';

async function main() {
  if (!env.GEMINI_API_KEY) { console.error('SKIP: GEMINI_API_KEY 미설정'); process.exit(2); }
  const { mimeType, data } = await generateImage(
    '깔끔한 미니멀 블로그 썸네일, 파스텔 배경에 "가습기 추천" 한글 텍스트, 실물 사진 아님, 일러스트 스타일',
  );
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const out = `scripts/naver/_gemini-out.${ext}`;
  writeFileSync(out, data);
  console.log('OK: gemini image', { mimeType, bytes: data.length, out });
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-gemini-image.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 4: 구현 (gemini-provider.ts의 클라이언트 패턴 준용)**

`src/infra/llm/gemini-image.ts`:

```ts
import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

let client: GoogleGenAI | null = null;
function ensureClient(): GoogleGenAI {
  if (client) return client;
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
  client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

export async function generateImage(prompt: string): Promise<{ mimeType: string; data: Buffer }> {
  const model = env.GEMINI_MODEL_IMAGE;
  const c = ensureClient();
  const result = await c.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const parts = result.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    // @ts-expect-error inlineData는 이미지 응답에만 존재
    const inline = p.inlineData;
    if (inline?.data) {
      logger.info({ model, mimeType: inline.mimeType }, 'gemini image generated');
      return { mimeType: inline.mimeType ?? 'image/png', data: Buffer.from(inline.data, 'base64') };
    }
  }
  throw new Error('gemini image: 응답에 inlineData 없음 — 모델명(GEMINI_MODEL_IMAGE) 확인');
}
```

- [ ] **Step 5: 실행해 통과 확인 (실측)**

Run: `pnpm tsx scripts/naver/verify-gemini-image.ts`
Expected: `OK: gemini image` + `_gemini-out.png` 생성. (실패 시 모델명 조정 — 이미지 출력 지원 모델이어야 함.)

- [ ] **Step 6: 커밋**

```bash
git add src/infra/llm/gemini-image.ts src/config/env.ts scripts/naver/verify-gemini-image.ts
git commit -m "feat(naver): Gemini 보조 이미지 생성 어댑터"
```

---

## Task 6: 원고 SEO 스키마 + naver-copywriter

**Files:**
- Create: `src/modules/pipeline-d/naver-copywriter/schema.ts`
- Create: `src/modules/pipeline-d/naver-copywriter/index.ts`
- Test: `scripts/naver/verify-copywriter.ts`

**Interfaces:**
- Consumes: `llm` from `../../../infra/llm/index.js`(기존 텍스트 LLM 추상화). `CommerceSearchResult`.
- Produces:
  - `schema.ts`: `NaverPostDraftSchema`(Zod) + `type NaverPostDraft = { title: string; intro: string; sections: Array<{ heading: string; body: string }>; imageSlots: Array<{ afterSection: number; caption: string; kind: 'PRODUCT' | 'AI' }>; tags: string[]; disclaimer: string }`. `NAVER_LEGAL_DISCLAIMER` 상수.
  - `index.ts`: `generateNaverPost(input: NaverCopywriteInput): Promise<NaverPostDraft>` where `NaverCopywriteInput = { topic: string; product: { name: string; price?: number; category?: string; specs?: string }; connectUrl: string; kind: 'INFO' | 'AFFILIATE'; extraNote?: string }`.

- [ ] **Step 1: 스키마 파일 작성**

`src/modules/pipeline-d/naver-copywriter/schema.ts`:

```ts
import { z } from 'zod';

export const NAVER_LEGAL_DISCLAIMER =
  '본 포스팅은 네이버 쇼핑커넥트 활동의 일환으로, 구매 발생 시 일정액의 수수료를 제공받습니다.';

export const NaverPostDraftSchema = z.object({
  title: z.string().min(4).max(80),
  intro: z.string().min(40),                 // 첫 문단(결론 먼저, ~200자 가중 구간)
  sections: z.array(z.object({
    heading: z.string().min(2).max(30),      // 소제목(제목2/3용)
    body: z.string().min(30),
  })).min(3),
  imageSlots: z.array(z.object({
    afterSection: z.number().int().min(0),   // 0 = intro 뒤
    caption: z.string(),
    kind: z.enum(['PRODUCT', 'AI']),
  })).min(3),
  tags: z.array(z.string()).min(5).max(10),
  disclaimer: z.string(),
});

export type NaverPostDraft = z.infer<typeof NaverPostDraftSchema>;
```

- [ ] **Step 2: 검증 스크립트 먼저 작성**

`scripts/naver/verify-copywriter.ts`:

```ts
import { generateNaverPost } from '../../src/modules/pipeline-d/naver-copywriter/index.js';
import { NaverPostDraftSchema, NAVER_LEGAL_DISCLAIMER } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

async function main() {
  const draft = await generateNaverPost({
    topic: '뷰티·생활템',
    product: { name: '휴대용 무선 가습기 500ml', price: 24900, category: '생활용품', specs: '500ml, USB 충전, 저소음' },
    connectUrl: 'https://smartstore.naver.com/x/products/1',
    kind: 'AFFILIATE',
  });
  NaverPostDraftSchema.parse(draft); // 스키마 위반 시 throw
  console.log('title:', draft.title, `(${draft.title.length}자)`);
  console.log('sections:', draft.sections.length, '| imageSlots:', draft.imageSlots.length, '| tags:', draft.tags.length);
  const full = [draft.intro, ...draft.sections.map((s) => s.body)].join('\n');
  console.log('본문 대략 길이:', full.length, '자');
  if (!draft.disclaimer.includes('수수료')) throw new Error('공정위 문구 누락');
  if (draft.title.length > 80) throw new Error('제목 80자 초과');
  console.log('OK: naver copywriter (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-copywriter.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 4: 구현**

`src/modules/pipeline-d/naver-copywriter/index.ts`:

```ts
import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';
import { NaverPostDraftSchema, NAVER_LEGAL_DISCLAIMER, type NaverPostDraft } from './schema.js';

export interface NaverCopywriteInput {
  topic: string;
  product: { name: string; price?: number; category?: string; specs?: string };
  connectUrl: string;
  kind: 'INFO' | 'AFFILIATE';
  extraNote?: string;
}

const SYSTEM = `너는 네이버 블로그 상위노출(C-Rank·D.I.A.)을 아는 한국어 블로그 작가다.
규칙:
- 제목 80자 이내, 핵심 키워드 맨 앞, 숫자/질문형 활용.
- intro(첫 문단)는 결론·핵심 키워드를 먼저 던진다(스크롤·체류 유도).
- 소제목(heading) 3~6개, 각 15자 내외. 본문 합계 2000~2500자.
- 실사용·비교·후기형 구체 정보 위주(광고 카피 톤 금지, D.I.A. 대응).
- imageSlots: 소제목마다 최소 1개, 상품 실물이 필요한 곳은 kind="PRODUCT", 보조 그래픽/썸네일은 kind="AI".
- tags 5~10개(연관검색어·롱테일).
- disclaimer는 반드시 주어진 문구를 그대로 사용.
출력은 지정된 JSON 스키마만.`;

export async function generateNaverPost(input: NaverCopywriteInput): Promise<NaverPostDraft> {
  const affiliateLine = input.kind === 'AFFILIATE'
    ? `이 글은 제휴(쇼핑커넥트) 글이다. 본문 중 자연스러운 위치에 상품을 소개하되, 첫 상품 언급 전 disclaimer가 오도록 intro 끝 또는 첫 section에 배치를 전제한다. 커넥트 링크: ${input.connectUrl}`
    : `이 글은 순수 정보성 글이다. 특정 상품 판매 목적이 아니라 주제 정보를 제공한다.`;

  const user = `주제(블로그 단일 주제): ${input.topic}
상품: ${input.product.name}${input.product.price ? ` / ${input.product.price}원` : ''}${input.product.category ? ` / ${input.product.category}` : ''}
스펙: ${input.product.specs ?? '(없음)'}
${affiliateLine}
${input.extraNote ? `추가 지시: ${input.extraNote}` : ''}

disclaimer 문구(그대로 사용): "${NAVER_LEGAL_DISCLAIMER}"`;

  const result = await llm.complete({
    system: SYSTEM,
    userParts: [{ type: 'text', text: user }],
    jsonMode: true,
    temperature: 0.8,
    maxOutputTokens: 4096,
  });

  const parsed = extractJson(result.text);
  // disclaimer 강제 주입(모델이 변형해도 상수로 덮어씀)
  parsed.disclaimer = NAVER_LEGAL_DISCLAIMER;
  const draft = NaverPostDraftSchema.parse(parsed);
  logger.info({ title: draft.title, sections: draft.sections.length }, 'naver post generated');
  return draft;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`JSON 파싱 실패: ${text.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}
```

- [ ] **Step 5: 실행해 통과 확인 (실측)**

Run: `pnpm tsx scripts/naver/verify-copywriter.ts`
Expected: `OK: naver copywriter (실측)` + 제목/섹션/태그 수 출력, 본문 길이 2000자 내외. (스키마 위반이면 프롬프트/`maxOutputTokens` 조정.)

- [ ] **Step 6: 커밋**

```bash
git add src/modules/pipeline-d/naver-copywriter scripts/naver/verify-copywriter.ts
git commit -m "feat(naver): SEO 원고 스키마 + naver-copywriter (Sonnet)"
```

---

## Task 7: 복붙 패키지 렌더러 (순수 함수)

**Files:**
- Create: `src/modules/pipeline-d/publish-package/index.ts`
- Test: `scripts/naver/verify-package.ts`

**Interfaces:**
- Consumes: `NaverPostDraft`(Task 6), `imageUrls: string[]`.
- Produces: `buildPublishPackage(draft: NaverPostDraft, imageUrls: string[]): PublishPackage` where `PublishPackage = { blocks: Array<{ type: 'TITLE' | 'HEADING' | 'PARAGRAPH' | 'IMAGE' | 'TAGS' | 'DISCLAIMER'; text: string; note?: string; imageUrl?: string }>; plainText: string }`. 블록 순서 = 발행 순서. HEADING 블록은 `note: '에디터에서 제목2 스타일 지정'`. IMAGE 블록은 순서대로 `imageUrls`를 배정하고 `note`에 삽입 위치 안내.

- [ ] **Step 1: 검증 스크립트 먼저 작성**

`scripts/naver/verify-package.ts`:

```ts
import assert from 'node:assert';
import { buildPublishPackage } from '../../src/modules/pipeline-d/publish-package/index.js';
import type { NaverPostDraft } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

const draft: NaverPostDraft = {
  title: '무선 가습기 추천 3개월 실사용 후기',
  intro: '결론부터. 저소음·USB 충전 원하면 이거 하나로 끝납니다. 3개월 써본 솔직 후기예요.',
  sections: [
    { heading: '왜 이 가습기인가', body: '책상 위 공간을 거의 안 잡아먹습니다. ...' },
    { heading: '실사용 소음 체크', body: '밤에 틀어도 거슬리지 않는 수준. ...' },
    { heading: '단점도 솔직히', body: '물통이 작아 자주 채워야 합니다. ...' },
  ],
  imageSlots: [
    { afterSection: 0, caption: '제품 정면', kind: 'PRODUCT' },
    { afterSection: 1, caption: '소음 측정 그래픽', kind: 'AI' },
    { afterSection: 2, caption: '물통 크기 비교', kind: 'PRODUCT' },
  ],
  tags: ['무선가습기', '가습기추천', '저소음가습기', 'USB가습기', '생활템'],
  disclaimer: '본 포스팅은 네이버 쇼핑커넥트 활동의 일환으로, 구매 발생 시 일정액의 수수료를 제공받습니다.',
};

const pkg = buildPublishPackage(draft, ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg']);
assert.equal(pkg.blocks[0]!.type, 'TITLE');
const headings = pkg.blocks.filter((b) => b.type === 'HEADING');
assert.ok(headings.every((h) => h.note?.includes('제목2')), '소제목 스타일 안내 누락');
const images = pkg.blocks.filter((b) => b.type === 'IMAGE');
assert.equal(images.length, 3);
assert.ok(images.every((i) => i.imageUrl), '이미지 URL 미배정');
assert.ok(pkg.blocks.some((b) => b.type === 'DISCLAIMER'));
assert.ok(pkg.plainText.includes('무선 가습기 추천'));
console.log('OK: publish package renderer');
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-package.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/modules/pipeline-d/publish-package/index.ts`:

```ts
import type { NaverPostDraft } from '../naver-copywriter/schema.js';

export type PublishBlockType = 'TITLE' | 'HEADING' | 'PARAGRAPH' | 'IMAGE' | 'TAGS' | 'DISCLAIMER';
export interface PublishBlock {
  type: PublishBlockType;
  text: string;
  note?: string;
  imageUrl?: string;
}
export interface PublishPackage {
  blocks: PublishBlock[];
  plainText: string;
}

export function buildPublishPackage(draft: NaverPostDraft, imageUrls: string[]): PublishPackage {
  const blocks: PublishBlock[] = [];
  const imgQueue = [...imageUrls];

  blocks.push({ type: 'TITLE', text: draft.title, note: '제목란에 입력' });

  const emitImagesAfter = (sectionIndex: number) => {
    for (const slot of draft.imageSlots.filter((s) => s.afterSection === sectionIndex)) {
      const url = imgQueue.shift();
      blocks.push({
        type: 'IMAGE',
        text: slot.caption,
        imageUrl: url,
        note: url
          ? `여기에 이미지 삽입 (${slot.kind === 'PRODUCT' ? '상품 실물' : 'AI 보조'}): ${slot.caption}`
          : `이미지 필요(미확보): ${slot.caption}`,
      });
    }
  };

  blocks.push({ type: 'PARAGRAPH', text: draft.intro });
  blocks.push({ type: 'DISCLAIMER', text: draft.disclaimer, note: '첫 제휴 링크 전에 위치(공정위 필수)' });
  emitImagesAfter(0);

  draft.sections.forEach((sec, i) => {
    blocks.push({ type: 'HEADING', text: sec.heading, note: '에디터에서 제목2 스타일 지정' });
    blocks.push({ type: 'PARAGRAPH', text: sec.body });
    emitImagesAfter(i + 1);
  });

  // 남은 이미지가 있으면 말미에 배치
  while (imgQueue.length) {
    const url = imgQueue.shift()!;
    blocks.push({ type: 'IMAGE', text: '추가 이미지', imageUrl: url, note: '적절한 위치에 삽입' });
  }

  blocks.push({ type: 'TAGS', text: draft.tags.map((t) => `#${t}`).join(' '), note: '태그란에 입력' });

  const plainText = blocks
    .map((b) => (b.type === 'IMAGE' ? `[이미지: ${b.text}]` : b.text))
    .join('\n\n');

  return { blocks, plainText };
}
```

- [ ] **Step 4: 실행해 통과 확인**

Run: `pnpm tsx scripts/naver/verify-package.ts`
Expected: `OK: publish package renderer`.

- [ ] **Step 5: 커밋**

```bash
git add src/modules/pipeline-d/publish-package scripts/naver/verify-package.ts
git commit -m "feat(naver): 복붙 발행 패키지 렌더러 (블록+삽입 가이드)"
```

---

## Task 8: post-builder 오케스트레이터 + 7:3 비율 판정

**Files:**
- Create: `src/modules/pipeline-d/post-builder/index.ts`
- Test: `scripts/naver/verify-builder.ts`

**Interfaces:**
- Consumes: `parseShoppingConnectLink`(T2), `NaverShoppingAdapter`(T3), `resolveConnectUrl`/`fetchProductImages`(T4), `generateImage`(T5), `generateNaverPost`(T6), Cloudinary 업로드(`src/infra/cloudinary-client.ts`의 기존 업로드 함수), `prisma`.
- Produces:
  - `affiliateRatioExceeded(): Promise<{ exceeded: boolean; recent: number; affiliate: number; ratio: number }>` — 최근 10개 NaverPost 중 AFFILIATE 비율이 `NaverBlogConfig.affiliateRatio` 초과인지.
  - `buildNaverPost(input: { connectUrl: string; extraNote?: string; kind?: 'INFO' | 'AFFILIATE' }): Promise<{ naverPostId: string; title: string; ratioWarning: string | null }>` — 전체 파이프라인 실행 후 `NaverPost`(state=PLANNED) 저장.

- [ ] **Step 1: 검증 스크립트 먼저 작성 (비율 판정 중심, 순수 로직 우선)**

`scripts/naver/verify-builder.ts`:

```ts
import { prisma } from '../../src/db/prisma.js';
import { affiliateRatioExceeded, buildNaverPost } from '../../src/modules/pipeline-d/post-builder/index.js';

async function main() {
  const mode = process.argv[2]; // 'ratio' | 'full'
  await prisma.naverBlogConfig.upsert({
    where: { id: 'singleton' }, update: {}, create: { id: 'singleton', topic: '뷰티·생활템' },
  }).catch(async () => {
    const existing = await prisma.naverBlogConfig.findFirst();
    if (!existing) await prisma.naverBlogConfig.create({ data: { topic: '뷰티·생활템' } });
  });

  if (mode === 'ratio') {
    const r = await affiliateRatioExceeded();
    console.log('ratio result', r);
    console.log('OK: ratio check');
    return;
  }

  const link = process.argv[3];
  if (!link) { console.error('사용법: verify-builder.ts full <쇼핑커넥트 링크>'); process.exit(2); }
  const out = await buildNaverPost({ connectUrl: link, kind: 'AFFILIATE' });
  console.log('built', out);
  const post = await prisma.naverPost.findUnique({ where: { id: out.naverPostId } });
  if (!post || post.state !== 'PLANNED') throw new Error('NaverPost PLANNED 저장 실패');
  console.log('OK: builder full (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-builder.ts ratio`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/modules/pipeline-d/post-builder/index.ts`:

```ts
import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { parseShoppingConnectLink } from '../../../infra/naver/shopping-connect-link.js';
import { resolveConnectUrl, fetchProductImages } from '../../../infra/naver/smartstore-detail.js';
import { NaverShoppingAdapter } from '../../../infra/commerce/naver-shopping-client.js';
import { generateImage } from '../../../infra/llm/gemini-image.js';
import { uploadBufferToCloudinary } from '../../../infra/cloudinary-client.js';
import { generateNaverPost } from '../naver-copywriter/index.js';

const MAX_AI_IMAGES = 3;       // Global Constraint: AI 이미지 도배 금지
const RECENT_WINDOW = 10;

export async function affiliateRatioExceeded() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  const targetRatio = cfg?.affiliateRatio ?? 0.3;
  const recentPosts = await prisma.naverPost.findMany({
    orderBy: { createdAt: 'desc' }, take: RECENT_WINDOW, select: { kind: true },
  });
  const recent = recentPosts.length;
  const affiliate = recentPosts.filter((p) => p.kind === 'AFFILIATE').length;
  const ratio = recent === 0 ? 0 : affiliate / recent;
  return { exceeded: ratio > targetRatio, recent, affiliate, ratio };
}

export async function buildNaverPost(input: { connectUrl: string; extraNote?: string; kind?: 'INFO' | 'AFFILIATE' }) {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg) throw new Error('NaverBlogConfig 없음 — Admin에서 주제 설정 먼저');
  const kind = input.kind ?? 'AFFILIATE';

  // 1) 링크 해석
  const parsed = parseShoppingConnectLink(input.connectUrl);
  const finalUrl = parsed.productUrl ?? (await resolveConnectUrl(input.connectUrl));
  const reparsed = parsed.productId ? parsed : parseShoppingConnectLink(finalUrl);

  // 2) 상품 데이터 보강 (쇼핑검색 API)
  const adapter = new NaverShoppingAdapter(env.NAVER_CLIENT_ID ?? '', env.NAVER_CLIENT_SECRET ?? '');
  let product = reparsed.productId
    ? (await adapter.search(reparsed.productId).catch(() => []))[0] ?? null
    : null;
  // productId 검색이 비면 상세페이지 제목으로 재검색은 생략(초기) — 최소 정보로 진행
  const productName = product?.productName ?? '상품';
  const officialImages = (await fetchProductImages(reparsed.productUrl ?? finalUrl, { max: 6 }));
  const thumb = product?.thumbnailUrl ? [product.thumbnailUrl] : [];
  const productImageUrls = officialImages.length ? officialImages : thumb;

  // 3) 원고 생성
  const draft = await generateNaverPost({
    topic: cfg.topic,
    product: { name: productName, price: product?.price, category: product?.category },
    connectUrl: input.connectUrl,
    kind,
    extraNote: input.extraNote,
  });

  // 4) AI 보조 이미지 생성 (AI 슬롯 수만큼, 상한 MAX_AI_IMAGES)
  const aiSlots = draft.imageSlots.filter((s) => s.kind === 'AI').slice(0, MAX_AI_IMAGES);
  const aiImageUrls: string[] = [];
  for (const slot of aiSlots) {
    try {
      const { data, mimeType } = await generateImage(
        `네이버 블로그 보조 이미지, 실물 사진 아님(일러스트/그래픽). 주제: ${cfg.topic}. 내용: ${slot.caption}`,
      );
      const url = await uploadBufferToCloudinary(data, mimeType);
      aiImageUrls.push(url);
    } catch (err) {
      logger.warn({ err: (err as Error).message, caption: slot.caption }, 'AI 이미지 생성 실패, 스킵');
    }
  }

  // 5) 이미지 배열 = 공식(PRODUCT) 우선 + AI 보조. 순서는 패키지 렌더러가 슬롯에 배정.
  const imageUrls = [...productImageUrls, ...aiImageUrls];

  // 6) 저장
  let productRow = null;
  if (product) {
    productRow = await prisma.naverProduct.create({
      data: {
        externalId: product.externalId, productName: product.productName, productUrl: product.productUrl,
        connectUrl: input.connectUrl, thumbnailUrl: product.thumbnailUrl, price: product.price ?? null,
        imageUrls: productImageUrls,
      },
    });
  }
  const post = await prisma.naverPost.create({
    data: {
      state: 'PLANNED', kind, topic: cfg.topic, title: draft.title,
      draftJson: draft as unknown as object, connectUrl: input.connectUrl,
      imageUrls, productId: productRow?.id ?? null,
    },
  });

  const ratio = await affiliateRatioExceeded();
  const ratioWarning = kind === 'AFFILIATE' && ratio.exceeded
    ? `⚠️ 최근 ${ratio.recent}개 중 제휴 ${ratio.affiliate}개(${Math.round(ratio.ratio * 100)}%) — 목표 상한 초과. 정보성 글 권장.`
    : null;

  return { naverPostId: post.id, title: draft.title, ratioWarning };
}
```

- [ ] **Step 4: Cloudinary 버퍼 업로드 헬퍼 확인/추가**

`src/infra/cloudinary-client.ts`에 `uploadBufferToCloudinary(buffer: Buffer, mimeType: string): Promise<string>`가 없으면 추가(기존 업로드 함수 옆에):

```ts
export async function uploadBufferToCloudinary(buffer: Buffer, mimeType: string): Promise<string> {
  const b64 = buffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${b64}`;
  const res = await cloudinary.uploader.upload(dataUri, { folder: env.CLOUDINARY_UPLOAD_FOLDER });
  return res.secure_url;
}
```

(기존 파일의 import·`cloudinary` 인스턴스·`env` 사용 형태에 맞춰 조정. 이미 동등 함수가 있으면 그것을 import해 재사용하고 이 스텝은 스킵.)

- [ ] **Step 5: 실행해 통과 확인**

Run: `pnpm tsx scripts/naver/verify-builder.ts ratio`
Expected: `OK: ratio check` + ratio 객체 출력.
Run(실측, 키·링크 준비 시): `pnpm tsx scripts/naver/verify-builder.ts full <실제 쇼핑커넥트 링크>`
Expected: `OK: builder full (실측)` + NaverPost PLANNED 저장.

- [ ] **Step 6: 커밋**

```bash
git add src/modules/pipeline-d/post-builder src/infra/cloudinary-client.ts scripts/naver/verify-builder.ts
git commit -m "feat(naver): post-builder 오케스트레이터 + 7:3 비율 판정"
```

---

## Task 9: Admin 발행 페이지

**Files:**
- Create: `src/modules/shared/admin/naver-routes.ts`
- Modify: `src/index.ts` (register)
- Test: `scripts/naver/verify-admin-route.ts`

**Interfaces:**
- Consumes: `buildPublishPackage`(T7), `prisma`, `NaverPostDraft`.
- Produces: `registerNaverRoutes(app)`. Routes: `GET /admin/naver`(PLANNED/READY 목록), `GET /admin/naver/:id`(발행 페이지 — 블록별 복사 버튼 + 이미지 순서·삽입 가이드 + 순서대로 이미지 썸네일), `POST /admin/naver/:id/published`(state=PUBLISHED, publishedAt 기록).

- [ ] **Step 1: 검증 스크립트 먼저 작성 (렌더 함수 단위)**

렌더는 순수 함수 `renderPublishPage(post, pkg)`로 분리해 테스트한다.

`scripts/naver/verify-admin-route.ts`:

```ts
import assert from 'node:assert';
import { renderPublishPage } from '../../src/modules/shared/admin/naver-routes.js';
import { buildPublishPackage } from '../../src/modules/pipeline-d/publish-package/index.js';
import type { NaverPostDraft } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

const draft: NaverPostDraft = {
  title: 'T', intro: '결론 먼저 인트로 문단입니다 어쩌구', sections: [
    { heading: '소제목1', body: '본문1' }, { heading: '소제목2', body: '본문2' }, { heading: '소제목3', body: '본문3' },
  ], imageSlots: [
    { afterSection: 0, caption: 'c0', kind: 'PRODUCT' }, { afterSection: 1, caption: 'c1', kind: 'AI' }, { afterSection: 2, caption: 'c2', kind: 'PRODUCT' },
  ], tags: ['a', 'b', 'c', 'd', 'e'], disclaimer: '수수료 안내',
};
const pkg = buildPublishPackage(draft, ['https://img/1', 'https://img/2', 'https://img/3']);
const html = renderPublishPage({ id: 'x', title: 'T', state: 'PLANNED' }, pkg);
assert.ok(html.includes('제목2 스타일'), '소제목 가이드 렌더 누락');
assert.ok(html.includes('복사'), '복사 버튼 누락');
assert.ok(html.includes('https://img/1'), '이미지 미표시');
console.log('OK: admin publish page render');
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-admin-route.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현 (home-routes.ts 패턴 준용)**

`src/modules/shared/admin/naver-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { buildPublishPackage, type PublishPackage } from '../../pipeline-d/publish-package/index.js';
import type { NaverPostDraft } from '../../pipeline-d/naver-copywriter/schema.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderPublishPage(
  post: { id: string; title: string | null; state: string },
  pkg: PublishPackage,
): string {
  const blocksHtml = pkg.blocks.map((b, i) => {
    const img = b.imageUrl ? `<img src="${esc(b.imageUrl)}" style="max-width:220px;border-radius:8px;display:block;margin:8px 0">` : '';
    const note = b.note ? `<div class="note">${esc(b.note)}</div>` : '';
    const copyBtn = b.type === 'IMAGE' ? '' : `<button class="copy" data-i="${i}">복사</button>`;
    return `<div class="block ${b.type}">
      <div class="btype">${b.type}${copyBtn}</div>
      ${note}
      <div class="text" id="blk-${i}">${esc(b.text)}</div>
      ${img}
    </div>`;
  }).join('\n');

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>발행 · ${esc(post.title ?? post.id)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#222}
.block{border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px;margin:12px 0;background:#fafafa}
.btype{font-size:.72em;color:#888;letter-spacing:.05em;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
.text{white-space:pre-wrap;line-height:1.65}
.note{background:#fff6e5;border-left:3px solid #f0ad4e;padding:6px 10px;font-size:.82em;color:#8a6d3b;margin-bottom:8px;border-radius:4px}
.HEADING .text{font-weight:700;font-size:1.15em}
.TITLE .text{font-weight:700;font-size:1.35em}
.copy{font-size:.8em;padding:3px 10px;border:1px solid #0969da;background:#fff;color:#0969da;border-radius:5px;cursor:pointer}
.copy:hover{background:#0969da;color:#fff}
.done{margin-top:24px}
.done button{padding:10px 18px;background:#1a7f37;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:.95em}
</style></head><body>
<h1>${esc(post.title ?? '(제목 미정)')}</h1>
<p style="color:#888">state: ${post.state} · 블록별 복사 → 네이버 에디터 붙여넣기. 소제목은 에디터에서 "제목2" 스타일 지정, 이미지는 표시 순서대로 삽입.</p>
${blocksHtml}
<form class="done" method="POST" action="/admin/naver/${post.id}/published">
  <button type="submit">✅ 발행 완료로 표시</button>
</form>
<script>
document.querySelectorAll('.copy').forEach((btn) => {
  btn.addEventListener('click', () => {
    const i = btn.getAttribute('data-i');
    const t = document.getElementById('blk-' + i).innerText;
    navigator.clipboard.writeText(t).then(() => { btn.textContent = '복사됨'; setTimeout(() => btn.textContent = '복사', 1200); });
  });
});
</script></body></html>`;
}

function renderList(rows: Array<{ id: string; title: string | null; state: string; kind: string; createdAt: Date }>): string {
  const items = rows.map((r) => `<li><a href="/admin/naver/${r.id}">${esc(r.title ?? r.id)}</a> <span style="color:#999">· ${r.kind} · ${r.state}</span></li>`).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>네이버 발행 대기</title>
<style>body{font-family:-apple-system,sans-serif;max-width:720px;margin:32px auto;padding:0 16px}li{margin:8px 0}</style></head>
<body><h1>네이버 블로그 · 발행 대기</h1><ul>${items || '<p>대기 중인 원고 없음</p>'}</ul></body></html>`;
}

export async function registerNaverRoutes(app: AnyFastify): Promise<void> {
  app.get('/admin/naver', async (_req, reply) => {
    const rows = await prisma.naverPost.findMany({
      where: { state: { in: ['PLANNED', 'READY'] } }, orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, state: true, kind: true, createdAt: true },
    });
    return reply.type('text/html').send(renderList(rows));
  });

  app.get('/admin/naver/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const post = await prisma.naverPost.findUnique({ where: { id } });
    if (!post || !post.draftJson) return reply.code(404).send('not found');
    const pkg = buildPublishPackage(post.draftJson as unknown as NaverPostDraft, post.imageUrls);
    return reply.type('text/html').send(renderPublishPage(post, pkg));
  });

  app.post('/admin/naver/:id/published', async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.naverPost.update({ where: { id }, data: { state: 'PUBLISHED', publishedAt: new Date() } });
    return reply.redirect('/admin/naver');
  });
}
```

- [ ] **Step 4: index.ts에 등록**

`src/index.ts`에 import + register 추가(다른 `registerXxxRoutes` 옆):

```ts
import { registerNaverRoutes } from './modules/shared/admin/naver-routes.js';
// ...
  await registerNaverRoutes(app);
```

- [ ] **Step 5: 실행해 통과 확인**

Run: `pnpm tsx scripts/naver/verify-admin-route.ts`
Expected: `OK: admin publish page render`.
Run(수동): `pnpm typecheck` → 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/modules/shared/admin/naver-routes.ts src/index.ts scripts/naver/verify-admin-route.ts
git commit -m "feat(naver): Admin 발행 페이지(블록 복사+삽입 가이드) + 라우트 등록"
```

---

## Task 10: 텔레그램 `/naver` 커맨드

**Files:**
- Modify: `src/modules/shared/approval-gate/bot.ts`
- Test: `scripts/naver/verify-bot-handler.ts`

**Interfaces:**
- Consumes: `buildNaverPost`(T8), `env.APP_PORT`(발행 페이지 URL 조립).
- Produces: bot.ts에 `bot.command('naver', ...)` 추가. 로직을 테스트 가능하게 `handleNaverCommand(connectUrl: string): Promise<string>`(순수하게 문자열 응답 반환)로 분리해 `naver-command.ts`에 두고 bot에서 호출.

- [ ] **Step 1: 커맨드 로직 분리 파일 + 검증 스크립트**

`src/modules/shared/approval-gate/naver-command.ts`:

```ts
import { env } from '../../../config/env.js';
import { buildNaverPost } from '../../pipeline-d/post-builder/index.js';

export async function handleNaverCommand(connectUrl: string): Promise<string> {
  if (!connectUrl || !/^https?:\/\//.test(connectUrl)) {
    return '사용법: /naver <쇼핑커넥트 링크>\n예: /naver https://smartstore.naver.com/x/products/123';
  }
  const out = await buildNaverPost({ connectUrl });
  const pageUrl = `http://localhost:${env.APP_PORT}/admin/naver/${out.naverPostId}`;
  const warn = out.ratioWarning ? `\n${out.ratioWarning}` : '';
  return `✅ 네이버 원고 생성 완료\n제목: ${out.title}\n발행 페이지: ${pageUrl}${warn}`;
}
```

`scripts/naver/verify-bot-handler.ts`:

```ts
import assert from 'node:assert';
import { handleNaverCommand } from '../../src/modules/shared/approval-gate/naver-command.js';

async function main() {
  const bad = await handleNaverCommand('');
  assert.ok(bad.includes('사용법'), '빈 입력 안내 누락');
  console.log('OK: /naver 입력 검증'); // 실 생성은 verify-builder full로 커버
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-bot-handler.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: bot.ts에 커맨드 등록**

`src/modules/shared/approval-gate/bot.ts` 상단 import에 추가:

```ts
import { handleNaverCommand } from './naver-command.js';
```

`/ingest` 커맨드 정의 근처에 추가:

```ts
// /naver — 쇼핑커넥트 링크 → SEO 원고 생성 → Admin 발행 페이지
bot.command('naver', async (ctx) => {
  const link = ctx.match?.trim() ?? '';
  await ctx.reply('🟢 네이버 원고 생성 중... (상품 조회·이미지·원고)');
  try {
    const msg = await handleNaverCommand(link);
    await ctx.reply(msg, { disable_web_page_preview: true });
  } catch (err) {
    await ctx.reply(`❌ 실패: ${(err as Error).message}`);
  }
});
```

(`naver-command.ts`가 완성 상태 문자열을 반환하므로 bot 핸들러는 얇게 유지.)

- [ ] **Step 4: 실행해 통과 확인**

Run: `pnpm tsx scripts/naver/verify-bot-handler.ts`
Expected: `OK: /naver 입력 검증`.
Run: `pnpm typecheck` → 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/modules/shared/approval-gate/bot.ts src/modules/shared/approval-gate/naver-command.ts scripts/naver/verify-bot-handler.ts
git commit -m "feat(naver): 텔레그램 /naver 커맨드 → 원고 생성 → 발행 페이지 링크"
```

---

## Task 11: e2e 실측 + 문서 갱신

**Files:**
- Test: `scripts/naver/verify-e2e.ts`
- Modify: `docs/STATE.md`, `docs/TASKS.md`

**Interfaces:**
- Consumes: 전체 파이프라인.

- [ ] **Step 1: e2e 스크립트 작성**

`scripts/naver/verify-e2e.ts`:

```ts
import { handleNaverCommand } from '../../src/modules/shared/approval-gate/naver-command.js';

async function main() {
  const link = process.argv[2];
  if (!link) { console.error('사용법: verify-e2e.ts <실제 쇼핑커넥트 링크>'); process.exit(2); }
  const msg = await handleNaverCommand(link);
  console.log(msg);
  if (!msg.includes('발행 페이지')) throw new Error('발행 페이지 URL 누락');
  console.log('OK: e2e (실측) — 위 URL을 브라우저로 열어 블록/이미지 확인');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 서버 띄우고 실측**

Run: (터미널 1) `pnpm dev`  · (터미널 2) `pnpm tsx scripts/naver/verify-e2e.ts <실제 링크>`
Expected: 원고 생성 → 발행 페이지 URL 출력. 브라우저로 URL 열어 제목·블록·소제목 가이드·이미지 순서 육안 확인.

- [ ] **Step 3: 문서 갱신**

`docs/STATE.md`에 Pipeline D 라인 추가(검증된 것 표 + BullMQ/크론은 해당 없음 명시), `docs/TASKS.md`에 완료 태스크 반영.

- [ ] **Step 4: 커밋**

```bash
git add scripts/naver/verify-e2e.ts docs/STATE.md docs/TASKS.md
git commit -m "test(naver): e2e 실측 스크립트 + STATE/TASKS 갱신"
```

---

## Task 12: 카테고리 필드 + config 시드 (INFO 흐름 기반)

**Files:**
- Modify: `prisma/schema.prisma` (NaverBlogConfig에 `categories String[]`, NaverPost에 `category String?`)
- Create: `scripts/naver/seed-config.ts`
- Test: `scripts/naver/verify-config.ts`

**Interfaces:**
- Produces: `NaverBlogConfig.categories String[] @default([])`; `NaverPost.category String?`. 시드 스크립트가 단일 config 행 생성/갱신(topic=`뉴트로·생활템·생활가전`, categories=`["레트로주방","인테리어소품","생활가전","수납정리"]`).

- [ ] **Step 1: 스키마 수정**

`prisma/schema.prisma` — `NaverBlogConfig`에 필드 추가:
```prisma
  categories     String[] @default([])
```
`NaverPost`에 필드 추가(`topic` 아래):
```prisma
  category           String?
```

- [ ] **Step 2: 마이그레이션**

Run: `pnpm prisma migrate dev --name naver-categories`
Expected: additive 마이그레이션 성공. (drift/interactive 프롬프트면 STOP·BLOCKED 보고, reset 금지.)
주의(Windows): `prisma generate`가 실행 중 `pnpm dev`/`dev:worker`/`dev:bot`의 파일락에 걸리면 해당 tsx-watch 프로세스 정지 후 generate, 재기동.

- [ ] **Step 3: 시드 스크립트**

`scripts/naver/seed-config.ts`:
```ts
import { prisma } from '../../src/db/prisma.js';

async function main() {
  const existing = await prisma.naverBlogConfig.findFirst();
  const data = {
    topic: '뉴트로·생활템·생활가전',
    categories: ['레트로주방', '인테리어소품', '생활가전', '수납정리'],
  };
  const row = existing
    ? await prisma.naverBlogConfig.update({ where: { id: existing.id }, data })
    : await prisma.naverBlogConfig.create({ data });
  console.log('config', { id: row.id, topic: row.topic, categories: row.categories });
  console.log('OK: config seeded');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: 검증 스크립트**

`scripts/naver/verify-config.ts`:
```ts
import assert from 'node:assert';
import { prisma } from '../../src/db/prisma.js';

async function main() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  assert.ok(cfg, 'config 없음 — seed-config 먼저 실행');
  assert.ok(cfg.categories.length >= 1, 'categories 비어있음');
  console.log('OK: config', cfg.topic, cfg.categories);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: 실행 (시드 → 검증)**

Run: `pnpm tsx scripts/naver/seed-config.ts` → `OK: config seeded`
Run: `pnpm tsx scripts/naver/verify-config.ts` → `OK: config ...`

- [ ] **Step 6: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations scripts/naver/seed-config.ts scripts/naver/verify-config.ts
git commit -m "feat(naver): 카테고리 필드 + config 시드"
```

---

## Task 13: 정보글(INFO) 생성 경로 — 앵글 생성기 + buildInfoPost

**Files:**
- Create: `src/modules/pipeline-d/info-post/index.ts`
- Test: `scripts/naver/verify-info-post.ts`

**Interfaces:**
- Consumes: `llm`, `generateNaverPost`(T6, kind='INFO'), `generateImage`(T5), `uploadBufferToCloudinary`(T8), `prisma`, `NaverBlogConfig.categories`.
- Produces:
  - `generateInfoAngle(category: string, recentTitles: string[]): Promise<string>` — 카테고리 내 정보성 글 주제(앵글) 한 줄 생성, `recentTitles`와 중복 회피.
  - `pickNextCategory(): Promise<string>` — 최근 INFO 글의 category 사용 빈도가 가장 낮은 카테고리 반환(순환).
  - `buildInfoPost(opts?: { category?: string; angleHint?: string }): Promise<{ naverPostId: string; title: string; category: string }>` — 상품 없이 INFO NaverPost(state=PLANNED, kind=INFO) 생성.

- [ ] **Step 1: 검증 스크립트 먼저 작성**

`scripts/naver/verify-info-post.ts`:
```ts
import { prisma } from '../../src/db/prisma.js';
import { buildInfoPost, pickNextCategory } from '../../src/modules/pipeline-d/info-post/index.js';

async function main() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg || cfg.categories.length === 0) { console.error('SKIP: config/categories 없음 — seed-config 먼저'); process.exit(2); }
  const cat = await pickNextCategory();
  console.log('picked category', cat);
  const out = await buildInfoPost();
  console.log('built', out);
  const post = await prisma.naverPost.findUnique({ where: { id: out.naverPostId } });
  if (!post || post.state !== 'PLANNED' || post.kind !== 'INFO') throw new Error('INFO PLANNED 저장 실패');
  if (post.productId) throw new Error('INFO 글에 상품 연결됨(있으면 안 됨)');
  console.log('OK: info post (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `pnpm tsx scripts/naver/verify-info-post.ts`
Expected: FAIL — 모듈 미존재.

- [ ] **Step 3: 구현**

`src/modules/pipeline-d/info-post/index.ts`:
```ts
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { llm } from '../../../infra/llm/index.js';
import { generateImage } from '../../../infra/llm/gemini-image.js';
import { uploadBufferToCloudinary } from '../../../infra/cloudinary-client.js';
import { generateNaverPost } from '../naver-copywriter/index.js';

const MAX_AI_IMAGES = 3;

export async function pickNextCategory(): Promise<string> {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg || cfg.categories.length === 0) throw new Error('NaverBlogConfig.categories 비어있음 — seed-config 실행');
  const recent = await prisma.naverPost.findMany({
    where: { kind: 'INFO', category: { not: null } },
    orderBy: { createdAt: 'desc' }, take: cfg.categories.length * 2, select: { category: true },
  });
  const counts = new Map<string, number>(cfg.categories.map((c) => [c, 0]));
  for (const r of recent) if (r.category && counts.has(r.category)) counts.set(r.category, counts.get(r.category)! + 1);
  // 사용 빈도 최소 카테고리(동률이면 categories 순서 우선)
  return cfg.categories.reduce((best, c) => (counts.get(c)! < counts.get(best)! ? c : best), cfg.categories[0]!);
}

export async function generateInfoAngle(category: string, recentTitles: string[]): Promise<string> {
  const avoid = recentTitles.length ? `다음 최근 주제와 겹치지 말 것:\n- ${recentTitles.join('\n- ')}` : '';
  const result = await llm.complete({
    system: '너는 한국 네이버 블로그 정보성 글의 주제(앵글)를 딱 한 줄로 제안하는 도구다. 상품 판매가 아니라 독자에게 유용한 정보 주제. 출력은 주제 한 줄만.',
    userParts: [{ type: 'text', text: `블로그 주제 카테고리: ${category}\n검색 수요 있을 법한 정보성 글 주제 한 줄을 제안해라(제목 아님, 주제).\n${avoid}` }],
    temperature: 0.9, maxOutputTokens: 200,
  });
  return result.text.trim().replace(/^["'\-\s]+|["'\s]+$/g, '').split('\n')[0]!;
}

export async function buildInfoPost(opts?: { category?: string; angleHint?: string }): Promise<{ naverPostId: string; title: string; category: string }> {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg) throw new Error('NaverBlogConfig 없음');
  const category = opts?.category ?? (await pickNextCategory());

  const recentTitles = (await prisma.naverPost.findMany({
    where: { kind: 'INFO', category }, orderBy: { createdAt: 'desc' }, take: 8, select: { title: true },
  })).map((p) => p.title).filter((t): t is string => !!t);

  const angle = opts?.angleHint ?? (await generateInfoAngle(category, recentTitles));

  const draft = await generateNaverPost({
    topic: cfg.topic,
    product: { name: angle },           // INFO: 상품 대신 앵글을 소재로 전달
    connectUrl: '',
    kind: 'INFO',
    extraNote: `카테고리: ${category}. 정보성 글. 특정 상품 판매 목적이 아니라 "${angle}" 주제를 유용하게 다룬다. 제휴 링크·상품 추천 없음.`,
  });

  // INFO 보조 이미지 (AI 슬롯만, 상한). 상품 실물 없음.
  const aiSlots = draft.imageSlots.filter((s) => s.kind === 'AI').slice(0, MAX_AI_IMAGES);
  const imageUrls: string[] = [];
  for (const slot of aiSlots) {
    try {
      const { data, mimeType } = await generateImage(`네이버 블로그 정보성 글 보조 이미지(일러스트/그래픽, 실물 사진 아님). 주제: ${cfg.topic} · ${category}. 내용: ${slot.caption}`);
      imageUrls.push(await uploadBufferToCloudinary(data, mimeType));
    } catch (err) {
      logger.warn({ err: (err as Error).message, caption: slot.caption }, 'INFO AI 이미지 실패, 스킵');
    }
  }

  const post = await prisma.naverPost.create({
    data: {
      state: 'PLANNED', kind: 'INFO', topic: cfg.topic, category, title: draft.title,
      draftJson: draft as unknown as object, imageUrls,
    },
  });
  return { naverPostId: post.id, title: draft.title, category };
}
```

주의: INFO 원고엔 disclaimer가 필요 없다. `NaverPostDraftSchema.disclaimer`는 필수 문자열이므로 `generateNaverPost`가 INFO에도 상수를 주입한다 — INFO 글의 발행 페이지에서는 disclaimer 블록을 렌더하지 않도록 T9 렌더러가 `kind`에 따라 생략해야 한다(아래 Step 5 확인). 만약 T9가 이미 완료됐다면 이 조정은 T13의 일부로 반영한다.

- [ ] **Step 4: 실행해 통과 확인 (실측)**

Run: `pnpm tsx scripts/naver/verify-info-post.ts`
Expected: `OK: info post (실측)` + INFO PLANNED 저장, productId 없음.

- [ ] **Step 5: 발행 페이지 disclaimer 조건부 렌더 (T9 연계)**

`src/modules/shared/admin/naver-routes.ts`의 `GET /admin/naver/:id`에서 `post.kind === 'INFO'`면 `buildPublishPackage` 결과에서 DISCLAIMER 블록을 제외하고 렌더(또는 `buildPublishPackage`에 `includeDisclaimer` 옵션 추가). INFO 글엔 제휴 문구가 붙으면 안 됨. 변경 후 `scripts/naver/verify-package.ts`가 여전히 통과하는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/modules/pipeline-d/info-post src/modules/shared/admin/naver-routes.ts scripts/naver/verify-info-post.ts
git commit -m "feat(naver): 정보글(INFO) 생성 경로 — 앵글 생성기 + buildInfoPost"
```

---

## Task 14: 일일 정보글 크론 (naver-daily-info)

**Files:**
- Create: `src/modules/pipeline-d/daily-info-job/index.ts`
- Modify: 기존 큐/워커/스케줄 등록부 (`src/queues/queues.ts`, `src/pipeline/workers.ts`, 크론 등록 위치 — `sharing-publish-daily` 패턴을 그대로 따른다)
- Test: `scripts/naver/verify-daily-job.ts`

**Interfaces:**
- Consumes: `buildInfoPost`(T13), 텔레그램 알림(기존 `notifier`/봇 sendMessage 패턴), `env.APP_PORT`.
- Produces: `runDailyInfoJob(): Promise<{ naverPostId: string; title: string; category: string }>` — 하루 1회 INFO 글 생성 + 관리자에게 텔레그램 알림(제목·카테고리·발행 페이지 URL). BullMQ repeatable job `naver-daily-info`로 매일 KST 09:00 등록(기존 `sharing-publish-daily`와 동일 방식·시간대).

- [ ] **Step 1: 기존 크론 패턴 확인**

`sharing-publish-daily` 잡의 정의·등록(큐 생성, repeatable 옵션 cron, worker 핸들러, 텔레그램 알림)을 읽고 동일 구조로 `naver-daily-info`를 만든다. 새 패턴을 발명하지 말 것.

- [ ] **Step 2: 검증 스크립트 먼저 작성 (핸들러 직접 호출)**

`scripts/naver/verify-daily-job.ts`:
```ts
import { prisma } from '../../src/db/prisma.js';
import { runDailyInfoJob } from '../../src/modules/pipeline-d/daily-info-job/index.js';

async function main() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  if (!cfg || cfg.categories.length === 0) { console.error('SKIP: config 없음'); process.exit(2); }
  const out = await runDailyInfoJob();
  console.log('daily info', out);
  const post = await prisma.naverPost.findUnique({ where: { id: out.naverPostId } });
  if (!post || post.kind !== 'INFO') throw new Error('일일 INFO 생성 실패');
  console.log('OK: daily info job (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: 핸들러 구현**

`src/modules/pipeline-d/daily-info-job/index.ts`:
```ts
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { buildInfoPost } from '../info-post/index.js';
// 텔레그램 알림: 기존 approval-gate/notifier의 sendMessage 헬퍼를 재사용(정확한 export명은 파일 확인 후 import).
import { notifyAdmin } from '../../shared/approval-gate/notifier.js';

export async function runDailyInfoJob(): Promise<{ naverPostId: string; title: string; category: string }> {
  const out = await buildInfoPost();
  const pageUrl = `http://localhost:${env.APP_PORT}/admin/naver/${out.naverPostId}`;
  await notifyAdmin(`🟢 오늘의 일상글 초안 준비됨\n[${out.category}] ${out.title}\n발행 페이지: ${pageUrl}\n(복붙 발행하세요)`).catch((e) => logger.warn({ e }, '텔레그램 알림 실패'));
  logger.info({ naverPostId: out.naverPostId, category: out.category }, 'daily info job done');
  return out;
}
```
(`notifier.js`의 실제 export가 `notifyAdmin`가 아니면 그 파일의 헬퍼명으로 교체. 없으면 봇 인스턴스로 `sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, ...)` 직접 호출.)

- [ ] **Step 4: 크론 등록 (sharing-publish-daily 패턴 복제)**

`naver-daily-info` repeatable job을 매일 KST 09:00로 등록하고, worker에서 `runDailyInfoJob` 호출하도록 배선. 등록·핸들러 위치는 `sharing-publish-daily`와 동일 파일들.

- [ ] **Step 5: 실행해 통과 확인**

Run: `pnpm tsx scripts/naver/verify-daily-job.ts`
Expected: `OK: daily info job (실측)` + 텔레그램 알림 수신(관리자 챗) 또는 알림 실패 warn(핵심 생성은 성공).
Run: `pnpm typecheck` → 에러 없음. worker 기동 로그에 `naver-daily-info` 등록 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/modules/pipeline-d/daily-info-job src/queues/queues.ts src/pipeline/workers.ts scripts/naver/verify-daily-job.ts
git commit -m "feat(naver): 일일 정보글 크론 naver-daily-info (매일 09:00 생성+알림)"
```

---

## Self-Review

**Spec coverage:**
- §4 흐름(링크→보강→이미지→원고→승인알림→발행페이지→수동발행) → T2,T3,T4,T5,T6,T7,T8,T9,T10 ✅
- §5 SEO 스키마(제목/도입/본문/소제목/이미지/경험/커넥트/태그) → T6 스키마 + 프롬프트 ✅
- §6 운영 규칙(1주제/cadence/7:3/공정위) → `NaverBlogConfig`(T1) + 7:3 판정(T8) + `NAVER_LEGAL_DISCLAIMER` 강제(T6) ✅ (cadence 자동 스케줄은 범위 밖 — 수동 발행이므로 재고 개념만, spec §9 확정과 일치)
- §7 이미지 전략(공식 자동+Gemini 보조+SynthID 도배금지) → T3/T4(공식)+T5(AI)+T8(MAX_AI_IMAGES 상한) ✅
- §8 통합(재사용/신규/데이터모델 NaverPost 별도) → T1(별도 모델)+각 Task ✅
- 발행 UX(마크다운 미지원→블록 복사+삽입 가이드) → T7+T8 ✅

**Placeholder scan:** "적절한 에러처리" 류 없음. 모든 코드 스텝에 실제 코드 포함. T8 Step4는 "기존 함수 있으면 재사용" 조건부지만 대체 코드 제시 → 실행 가능.

**Type consistency:** `parseShoppingConnectLink`(T2) 반환 필드 `productId/productUrl/connectUrl` → T8에서 동일 사용 ✅. `NaverPostDraft`(T6) → T7 `buildPublishPackage`, T8 렌더, T9 `handleNaverCommand` 경유 일관 ✅. `buildNaverPost` 반환 `{ naverPostId, title, ratioWarning }` → T10에서 동일 필드 사용 ✅. `generateImage` 반환 `{ mimeType, data }` → T8 `uploadBufferToCloudinary(data, mimeType)` 일치 ✅.

**주의(실행자):** T3/T4/T5/T6/T8 실측 단계는 `.env`에 `NAVER_CLIENT_ID/SECRET`, `GEMINI_API_KEY`, `CLOUDINARY_*` 필요. 미설정 시 스크립트가 exit 2(SKIP)로 안내 — 그 경우 사용자에게 키 설정 요청 후 진행.
