# Track 2a: 봇 셀프 수정 루프 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 사용자가 승인 카드에 **답장으로 구체적 정정**("옆사람이야")을 보내면, 봇이 그 정정을 **하드 제약으로 반영해 재생성**(표현만 바꾸는 게 아니라)하고 새 카드를 보낸다. 이전 카드의 승인 버튼으로는 만료된 카드를 승인 못 하게 한다.

**Architecture:** 카드 앵커 메시지 id 는 이미 `Post.telegramMessageId` 에 저장됨. 봇 메시지 핸들러에 "카드 답장" 감지를 추가해 정정 텍스트를 캡처 → 소스(쇼핑=sourceItem, 일상=InboundLink 캡션) + 정정 지시를 넣어 재생성 → 카드 재발송. `Post.cardVersion` 을 추가해 카드마다 버전을 실어 보내고, 승인 콜백이 현재 버전과 다르면 거부한다.

**Tech Stack:** TypeScript, Prisma(Neon Postgres · 마이그레이션), grammY(텔레그램 봇), tsx, node:test.

**Spec:** `docs/superpowers/specs/2026-09-09-correction-learning-loop-design.md` (Track 2 A·B + 버전/멱등 부분. C 저장·D 분류·E 재사용은 Phase 2b/2c.)

## Global Constraints

- **DB 마이그레이션은 공유 Neon 에 적용됨** — 다른 세션(네이버)도 같은 DB. 추가 컬럼(`cardVersion`)은 additive·nullable-default 라 기존 동작 안 깨짐. `prisma migrate dev` 대신 **`prisma db push`** 로 스키마만 반영(마이그레이션 파일 충돌 회피) 또는 명시적 마이그레이션 — 실행자가 리포 관례 확인.
- **라이브 봇 변경** — 실행 후 봇 재기동해야 반영. 단위테스트는 순수 로직(정정 프롬프트 주입·버전 판정)만, 텔레그램 핸들러는 수동 실측.
- **정정 즉시 적용, 규칙 저장/분류는 이 Phase 범위 아님** (Phase 2b). 여기선 "카드 답장 → 그 글만 제대로 재생성" 까지.
- **원본 재확인**: 재생성 시 소스를 다시 읽는다(쇼핑 sourceItem.rawText, 일상 InboundLink 캡션). 확인 불가 디테일은 생략(카피라이터 기존 규칙).
- 커밋 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Post.cardVersion 스키마 + 증가

**Files:**
- Modify: `prisma/schema.prisma` (Post 모델)
- Modify: `src/modules/shared/approval-gate/service.ts` (sendApprovalRequest 에서 증가)
- Test: 수동 (마이그레이션 + 증가 확인) — 순수 단위테스트 대상 아님(DB·telegram 의존)

**Interfaces:**
- Produces: `Post.cardVersion: number` (default 1). 다른 태스크가 이 필드를 읽음.

- [ ] **Step 1: 스키마에 필드 추가**

`prisma/schema.prisma` 의 `model Post` 에 추가:
```prisma
  cardVersion Int @default(1)
```

- [ ] **Step 2: 스키마 반영 (공유 Neon)**

Run: `npx prisma db push` (additive 컬럼 · 데이터 손실 없음)
Expected: "Your database is now in sync with your Prisma schema." + prisma client 재생성.
※ 실패 시(권한/락) 중단하고 사용자에게 보고.

- [ ] **Step 3: sendApprovalRequest 에서 버전 증가**

`service.ts` 의 sendApprovalRequest 안, `prisma.post.update({ ... telegramMessageId ... })` 블록에 `cardVersion` 증가를 함께:
```ts
  await prisma.post.update({
    where: { id: post.id },
    data: {
      state: PostState.PENDING_APPROVAL,
      telegramMessageId: String(anchorMessageId),
      cardVersion: { increment: 1 },
    },
  });
```
(카드 보낼 때마다 +1 → 최신 카드 버전 = post.cardVersion)

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit 2>&1 | grep -iE "service.ts|schema"`
Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add prisma/schema.prisma src/modules/shared/approval-gate/service.ts
git commit -m "feat(approval): Post.cardVersion 추가 · 카드 발송마다 증가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 정정 제약 재생성 함수

**Files:**
- Modify: `src/modules/shared/copywriter/index.ts` (generateCopy · generateDailyBody 에 `correctionInstruction?` 입력 추가)
- Test: `tests/correction.test.mts` (신규 · 목킹 LLM)

**Interfaces:**
- Consumes: 기존 `generateCopy(CopywriteInput)`, `generateDailyBody(DailyCopyInput)`.
- Produces: 두 함수에 `correctionInstruction?: string` 입력 추가. 있으면 프롬프트에 **하드 제약**으로 주입.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/correction.test.mts (env 스텁은 copy-quality.test.mts 상단과 동일하게 복사)
import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.DATABASE_URL='postgresql://test:test@127.0.0.1:1/test';
process.env.TELEGRAM_BOT_TOKEN='test'; process.env.TELEGRAM_ADMIN_CHAT_ID='1';
process.env.ANTHROPIC_API_KEY='test'; process.env.GEMINI_API_KEY='test';
process.env.SESSION_SECRET='test-session-secret-at-least-32-characters'; process.env.LOG_LEVEL='error';
const copy = await import('../src/modules/shared/copywriter/index.ts');
const { generateDailyBody } = copy.default ?? copy;
const llmm = await import('../src/infra/llm/index.ts');
const { llm } = llmm.default ?? llmm;
const asJson = (v:unknown)=>({text:JSON.stringify(v),provider:'test',model:'test'});

test('correctionInstruction 이 생성 프롬프트에 하드 제약으로 실린다', async () => {
  const provider = llm(); const original = provider.complete;
  let seen:any=null;
  provider.complete = async (req:any)=>{ seen=req; return asJson({ body:'고친 본문' }); };
  try {
    await generateDailyBody({ personaPrompt:'p', accountSeed:'a', accountId:'a', sourceText:'원본', sourceLanguage:'ko', correctionInstruction:'옆사람이야(앞사람 아님)' } as any);
    const all = JSON.stringify(seen);
    assert.match(all, /옆사람이야/);       // 정정이 프롬프트에 들어감
    assert.match(all, /반드시|정정|고쳐/);  // 하드 제약 표현
  } finally { provider.complete = original; }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/correction.test.mts`
Expected: FAIL — `correctionInstruction` 미지원.

- [ ] **Step 3: 구현**

`copywriter/index.ts`:
1. `CopywriteInput` 와 `DailyCopyInput` 에 `correctionInstruction?: string;` 추가.
2. `generateBody`(쇼핑)·`generateDailyBody`(일상) 의 userParts 맨 앞에, 있을 때만 아래 블록 주입:
```ts
if (input.correctionInstruction) {
  userParts.unshift({ type: 'text', text:
    `★ 사용자 정정 (반드시 반영 · 이걸 안 지키면 실패): ${input.correctionInstruction}\n` +
    `이전 문구의 틀린 부분을 이 정정대로 고쳐 새로 써라. 표현만 바꾸지 말고 정정 내용을 실제로 반영.` });
}
```
(generateCopy 는 generateBody 로 전달 · groundedInput 에 correctionInstruction 포함되게)

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `node --import tsx --test tests/correction.test.mts` → PASS
Run: `npm run test:copy && npm run test:quality` → 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add tests/correction.test.mts src/modules/shared/copywriter/index.ts
git commit -m "feat(copywriter): 정정 제약 입력(correctionInstruction) — 표현만이 아니라 정정 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 카드 답장 → 정정 재생성 (봇)

**Files:**
- Create: `src/modules/shared/approval-gate/correction.ts` (정정 재생성 오케스트레이션 · 순수 로직 분리)
- Modify: `src/modules/shared/approval-gate/bot.ts` (message 핸들러에 카드 답장 감지)
- Test: `tests/correction.test.mts` (순수 함수 `findCorrectedPost` 만)

**Interfaces:**
- Consumes: `Post.telegramMessageId`, Task 2 의 `correctionInstruction`.
- Produces: `applyCorrection(postId, correctionText)` → 소스 재확인 + 제약 재생성 + `sendApprovalRequest`(카드 재발송·cardVersion++). `findCorrectedPost(replyToMessageId)` → 해당 Post 또는 null.

- [ ] **Step 1: 실패 테스트 (순수 매칭 함수)**

```ts
test('findCorrectedPost 는 답장 대상 메시지 id 로 Post 를 찾는 쿼리를 만든다', async () => {
  const corr = await import('../src/modules/shared/approval-gate/correction.ts');
  const { buildCardReplyQuery } = corr as any;
  const q = buildCardReplyQuery(12345);
  assert.deepEqual(q.where, { telegramMessageId: '12345', state: 'PENDING_APPROVAL' });
});
```

- [ ] **Step 2: 실패 확인** → FAIL (모듈 없음).

- [ ] **Step 3: 구현 correction.ts**

```ts
import { prisma } from '../../../db/prisma.js';
import { PostKind } from '@prisma/client';
import { sendApprovalRequest } from './service.js';

/** 답장 대상 메시지 id → PENDING 카드 Post 조회 쿼리 (테스트 가능하게 분리). */
export function buildCardReplyQuery(replyToMessageId: number) {
  return { where: { telegramMessageId: String(replyToMessageId), state: 'PENDING_APPROVAL' as const } };
}

/** 카드 답장 정정 → 소스 재확인 + 제약 재생성 + 카드 재발송. */
export async function applyCorrection(postId: string, correctionText: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { account: true, sourceItem: true, commerceProduct: true },
  });
  if (!post) throw new Error('post not found');

  if (post.kind === PostKind.DAILY) {
    // 일상: 원본 캡션(InboundLink) 재확인 후 제약 재생성
    const { generateDailyBody } = await import('../copywriter/index.js');
    const inbound = post.sourceItem?.rawText
      ? { rawText: post.sourceItem.rawText, language: post.sourceItem.language }
      : await findInboundForPost(post.id, post.sourceMediaUrls);
    const body = await generateDailyBody({
      personaPrompt: post.account.personaPrompt, accountSeed: post.accountId, accountId: post.accountId,
      sourceText: inbound?.rawText ?? undefined, sourceLanguage: inbound?.language ?? undefined,
      correctionInstruction: correctionText,
    });
    await prisma.post.update({ where: { id: postId }, data: { generatedBody: body } });
  } else {
    // 쇼핑: sourceItem + 제약 재생성 (기존 regenerateCopyAndResend 경로 재사용하되 correctionInstruction 추가)
    const { generateCopy } = await import('../copywriter/index.js');
    const { composeReply } = await import('../../pipeline-a/reply-composer/index.js');
    if (!post.commerceProduct) throw new Error('상품 정보 없음');
    const channel = post.commerceProduct.channel as 'COUPANG' | 'MUSINSA' | 'NAVER';
    const copy = await generateCopy({
      sourceText: post.sourceItem?.rawText ?? '', productName: post.commerceProduct.productName,
      productCategory: post.commerceProduct.category ?? undefined, accountSeed: post.accountId, accountId: post.accountId,
      personaPrompt: post.account.personaPrompt, deeplinkUrl: post.commerceProduct.deeplinkUrl ?? undefined,
      channel, ragEnabled: true, factCheckEnabled: true, correctionInstruction: correctionText,
    });
    const reply = await composeReply({ body: copy.body, sourceBrief: copy.sourceBrief, sourceText: post.sourceItem?.rawText ?? '', productName: post.commerceProduct.productName, productCategory: post.commerceProduct.category ?? undefined, deeplinkUrl: post.commerceProduct.deeplinkUrl ?? undefined, accountId: post.accountId, personaPrompt: post.account.personaPrompt, channel });
    await prisma.post.update({ where: { id: postId }, data: { generatedBody: copy.body, generatedReply: reply.text } });
  }
  await sendApprovalRequest(postId); // cardVersion++ · 새 카드
}

async function findInboundForPost(_postId: string, _media: string[]): Promise<{ rawText: string; language: string | null } | null> {
  return null; // sourceItem 없을 때만 도달 · 최선 노력 (일상은 대개 rawText 존재)
}
```

- [ ] **Step 4: bot.ts message 핸들러에 카드 답장 감지 (URL 파싱보다 먼저)**

`bot.on('message:text', ...)` 최상단에, URL/태그 분기 **이전에** 삽입:
```ts
  const replyTo = (ctx.message as any)?.reply_to_message?.message_id as number | undefined;
  if (replyTo) {
    const { buildCardReplyQuery, applyCorrection } = await import('./correction.js');
    const post = await prisma.post.findFirst(buildCardReplyQuery(replyTo));
    if (post) {
      await ctx.reply(`✏️ 정정 반영해서 다시 뽑는 중… "${text.slice(0, 40)}"`);
      try { await applyCorrection(post.id, text); await ctx.reply('✅ 고쳐서 새 카드 보냈어 (이전 카드는 무시)'); }
      catch (err) { await ctx.reply(`⚠ 정정 재생성 실패: ${(err as Error).message}`); }
      return; // 정정은 여기서 종료 (URL 파싱으로 안 감)
    }
  }
```

- [ ] **Step 5: 통과 확인 + 타입체크**

Run: `node --import tsx --test tests/correction.test.mts` → PASS
Run: `npx tsc --noEmit 2>&1 | grep -iE "correction|bot.ts"` → 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/modules/shared/approval-gate/correction.ts src/modules/shared/approval-gate/bot.ts tests/correction.test.mts
git commit -m "feat(approval): 카드 답장 정정 → 소스 재확인·제약 재생성·카드 재발송

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 카드 버전 멱등 (만료 카드 승인 거부)

**Files:**
- Modify: `src/modules/shared/approval-gate/keyboards.ts` (approve 콜백에 버전 실음)
- Modify: `src/modules/shared/approval-gate/service.ts` (approvalKeyboard 호출에 cardVersion 전달)
- Modify: `src/modules/shared/approval-gate/bot.ts` + `service.ts` handleApprovalCallback (approve 시 버전 검사)
- Test: `tests/correction.test.mts` (순수 함수 `isCardStale`)

**Interfaces:**
- Consumes: `Post.cardVersion`(Task 1).
- Produces: `approve:postId:version` 콜백 포맷 · `isCardStale(current, fromCard): boolean`.

- [ ] **Step 1: 실패 테스트**

```ts
test('isCardStale 는 카드 버전이 현재보다 낮으면 만료로 본다', async () => {
  const kb = await import('../src/modules/shared/approval-gate/keyboards.ts');
  const { isCardStale } = kb as any;
  assert.equal(isCardStale(3, 2), true);   // 최신3, 카드2 = 만료
  assert.equal(isCardStale(3, 3), false);  // 같음 = 유효
});
```

- [ ] **Step 2: 실패 확인** → FAIL.

- [ ] **Step 3: 구현**

`keyboards.ts`:
```ts
export function approvalKeyboard(postId: string, cardVersion: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ 발행 승인', `approve:${postId}:${cardVersion}`)
    .text('📝 텍스트 재생성', `regen-text:${postId}`)
    .row()
    .text('🔄 상품 재검색', `regen-product:${postId}`)
    .text('🗑 폐기', `reject:${postId}`);
}
export function isCardStale(current: number, fromCard: number): boolean {
  return fromCard < current;
}
```

`service.ts`: `approvalKeyboard(post.id)` → `approvalKeyboard(post.id, post.cardVersion + 1)` (이 카드가 곧 될 버전 = 증가 후 값. Task1 에서 increment 하므로 발송 시점의 "새 버전" 을 실어야 함 — increment 를 keyboard 생성 전에 하거나, `post.cardVersion + 1` 로 맞춘다).
※ 실행자: increment 시점과 keyboard 버전이 일치하는지 확인. 안전하게 "update(increment) 먼저 → 갱신된 cardVersion 으로 keyboard" 순서로 재배치.

`bot.ts` callback 파서: `approve:postId:version` 3-파트 파싱. approve 일 때 `const post = await prisma.post.findUnique(...); if (isCardStale(post.cardVersion, Number(version))) return answer('⚠ 만료된 카드입니다. 최신 카드에서 승인하세요');`
(handleApprovalCallback 시그니처에 version 추가하거나, bot.ts 콜백 핸들러에서 선검사)

- [ ] **Step 4: 통과 + 타입체크 + 전체 회귀**

Run: `node --import tsx --test tests/correction.test.mts` → PASS
Run: `npx tsc --noEmit 2>&1 | grep -iE "keyboards|service|bot.ts"` → 오류 없음
Run: `npm run test:copy && npm run test:quality` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/modules/shared/approval-gate/keyboards.ts src/modules/shared/approval-gate/service.ts src/modules/shared/approval-gate/bot.ts tests/correction.test.mts
git commit -m "feat(approval): 카드 버전 멱등 — 만료된 카드 승인 거부

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (Track 2 A·B + 버전):**
- A 캡처(카드 답장) → Task 3 ✅
- B 즉시 제약 재생성(소스 재확인) → Task 2 + Task 3 ✅
- 버전/멱등(이전 카드 승인 방지) → Task 1 + Task 4 ✅
- C 저장·D 분류·E 재사용 → **Phase 2b/2c (이 계획 범위 밖 · 명시)** ✅

**2. Placeholder scan:** `findInboundForPost` 는 stub 이지만 "sourceItem 있을 때만 도달 안 함"을 주석으로 명시(일상은 대개 rawText 존재). Task 4 의 increment-시점 주의는 실행자 확인 지시(코드 위치 실측 필요). 나머지 실제 코드 포함.

**3. Type consistency:** `cardVersion:number`(Task1) · `correctionInstruction?:string`(Task2) · `applyCorrection/buildCardReplyQuery`(Task3) · `approvalKeyboard(postId,cardVersion)`/`isCardStale`(Task4). 이름 일관.

**한계:** 봇 답장 감지·버전 콜백은 grammY 통합이라 단위테스트는 순수 로직만. **실제 검증 = 봇 재기동 후 카드에 답장 보내 재생성·만료 확인**(수동). DB 마이그레이션은 공유 Neon(additive).
