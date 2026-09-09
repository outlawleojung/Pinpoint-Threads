# Track 1: 생성 품질 검사 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쇼핑(Line A) 카피의 재발 3대 품질 갭 — 밋밋/반복 마무리, 본문 되풀이 댓글, 미확인 체험·인기·품절·효능 — 을 **강제가 아니라 검사**로 잡아 무수정 승인 가능성을 높인다.

**Architecture:** 본문 검사는 기존 `factCheckCopy`(Haiku/Sonnet 리뷰 스텝) 프롬프트에 "본문 품질" 항목을 추가해 실패 시 기존 재생성 루프가 다시 뽑게 한다. 댓글은 `reply-composer` 프롬프트에 검사 규칙 + 연결 멘트 로테이션을 추가한다. LLM 판단 자체(약한 마무리 감지 등)는 비결정적이라, 결정적 테스트는 "검사 항목이 프롬프트에 실림 + 실패 시 재생성 배선"만 검증하고, 실제 품질 개선은 **라이브 평가 스크립트**로 flag rate를 측정한다.

**Tech Stack:** TypeScript, tsx, node:test(오프라인·목킹 LLM), Anthropic Claude(main/fast tier), 기존 `llm().complete` 스텁 패턴.

**Spec:** `docs/superpowers/specs/2026-09-09-correction-learning-loop-design.md` (Track 1 부분)

## Global Constraints

- **강한 마무리·특정 형식을 강제하지 않는다.** 모든 글에 강한 마무리 강제 → 상투구 유발. "약하거나 반복이면 잡는다"만.
- **1인칭 사용·목격·소장 톤은 허용** (사용자 방침 · 기존 유지). 조작 방지는 "틀린 브랜드·지어낸 비교·없는 체험/인기/품절/효능"에만.
- 본문 검사 실패 시 재생성 최대 횟수는 기존 `factCheckMaxRetries`(기본 1 → 최대 2회 생성)를 그대로 쓴다. 새 무한 루프 만들지 않는다.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 오프라인 테스트는 네트워크·실크레덴셜·DB·텔레그램 호출 금지 (기존 `tests/source-preservation.test.mts` 상단 env 스텁 방식 따름).

---

### Task 1: 본문 품질 검사 (factCheckCopy 확장)

**Files:**
- Modify: `src/modules/shared/copywriter/index.ts` (factCheckCopy 시스템 프롬프트 · 함수는 이미 export)
- Test: `tests/copy-quality.test.mts` (신규)

**Interfaces:**
- Consumes: 기존 `factCheckCopy(args: { body; productName?; productCategory?; sourceBrief?; sourceText? })` → `{ ok: boolean; reason?: string }`. `generateCopy`가 실패 시 재생성.
- Produces: 없음(내부 프롬프트만 변경). 시그니처 불변.

- [ ] **Step 1: 실패 테스트 작성** — 검사 항목이 프롬프트에 실리는지 + 실패 시 재생성되는지.

```ts
// tests/copy-quality.test.mts (상단 env 스텁은 source-preservation.test.mts 와 동일하게 복사)
import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
process.env.TELEGRAM_BOT_TOKEN = 'test'; process.env.TELEGRAM_ADMIN_CHAT_ID = '1';
process.env.ANTHROPIC_API_KEY = 'test'; process.env.GEMINI_API_KEY = 'test';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters'; process.env.LOG_LEVEL = 'error';
const copyModule = await import('../src/modules/shared/copywriter/index.ts');
const { factCheckCopy } = copyModule.default ?? copyModule;
const llmModule = await import('../src/infra/llm/index.ts');
const { llm } = llmModule.default ?? llmModule;
const asJson = (v: unknown) => ({ text: JSON.stringify(v), provider: 'test', model: 'test' });

test('factCheck 프롬프트에 본문 품질 검사 항목이 포함된다', async () => {
  const provider = llm(); const original = provider.complete;
  let seen: any = null;
  provider.complete = async (req) => { seen = req; return asJson({ ok: true, reason: '' }); };
  try {
    await factCheckCopy({ body: '아무 본문', productName: '신발' });
    assert.ok(seen, 'complete 호출됨');
    assert.match(seen.system, /본문 품질/);
    assert.match(seen.system, /끝.*(반복|힘)/);       // 마무리 반복/힘빠짐 검사
    assert.match(seen.system, /인기|품절|효능/);       // 미확인 주장 검사
  } finally { provider.complete = original; }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --import tsx --test tests/copy-quality.test.mts`
Expected: FAIL — 현재 프롬프트에 "본문 품질" 문구 없음 → `assert.match` 실패.

- [ ] **Step 3: 최소 구현** — factCheckCopy 시스템 프롬프트에 "본문 품질" 블록 추가.

`src/modules/shared/copywriter/index.ts` 의 factCheckCopy `system` 문자열에서, 기존 "**판정 원칙**" 줄 바로 앞(또는 §1/§2 뒤)에 아래를 삽입:

```
3) 본문 품질 (강제 아님 · 약하거나 반복이면만 ok=false):
- **끝 문장이 앞 문장을 반복하거나 힘을 빼는가?** 구체적 매력이 마지막에 죽으면 ok=false.
  예 FAIL: "...동전 안쏟아지는 게 킥이더라. 동전 안쏟아지게 잘 만들었네" (끝이 앞말 반복)
- **구체적인 매력이 살아 있는가?** 다른 상품에 그대로 붙는 범용 감탄으로만 끝나면 ok=false.
- **없는 체험·인기·품절·효능·비교를 사실처럼 덧붙였는가?** (예: "다들 산다", "품절대란", "효과 검증됨") → ok=false.
※ 강한 마무리를 "강제"하지 마라. 짧고 담백해도 끝이 죽지만 않으면 ok=true.
```

(주의: 기존 `${args.sourceBrief ? ...}` 조건 블록이 있던 자리에는 이미 틀린사실 방지 규칙이 통합돼 있으니, 이 "본문 품질"은 그와 별개 항목 §3 로 추가. §번호 충돌 없으면 §3, 있으면 다음 번호.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --test tests/copy-quality.test.mts`
Expected: PASS.

- [ ] **Step 5: 재생성 배선 테스트 추가** — 품질 사유로 ok:false면 generateCopy가 재생성.

```ts
test('본문 품질 실패 시 generateCopy가 재생성한다', async () => {
  const { generateCopy } = copyModule.default ?? copyModule;
  const provider = llm(); const original = provider.complete;
  const brief = { situation:'s', points:[{fact:'f',evidenceType:'source_text',evidence:'x'}], focusIndex:0, allowedChanges:['한국어 말투'], unknowns:[] };
  // 순서: analyzeSource(brief) → body1(약함) → verdict(ok:false) → body2(좋음) → verdict(ok:true)
  const outputs = [ brief, { body:'약한 본문 약한 본문' }, { ok:false, reason:'끝 반복' }, { body:'좋은 본문임' }, { ok:true, reason:'' } ];
  provider.complete = async () => asJson(outputs.shift());
  try {
    const r = await generateCopy({ sourceText:'x', productName:'신발', accountSeed:'t', ragEnabled:false, factCheckEnabled:true });
    assert.equal(r.body, '좋은 본문임');   // 재생성본 채택
  } finally { provider.complete = original; }
});
```

Run: `node --import tsx --test tests/copy-quality.test.mts`
Expected: PASS (재생성 배선은 기존 기능 · 품질 사유로도 동작 확인).

- [ ] **Step 6: 커밋**

```bash
git add tests/copy-quality.test.mts src/modules/shared/copywriter/index.ts
git commit -m "feat(copywriter): 본문 품질 검사(마무리 반복·힘빠짐·미확인주장) 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 댓글 품질 검사 + 연결 멘트 다양성 (reply-composer)

**Files:**
- Modify: `src/modules/pipeline-a/reply-composer/index.ts` (SYSTEM_PROMPT + 연결 멘트 로테이션)
- Test: `tests/copy-quality.test.mts` (Task 1 파일에 이어서)

**Interfaces:**
- Consumes: 기존 `composeReply(input)` (reply-composer export). 실행 전 파일을 열어 현재 시그니처·SYSTEM_PROMPT 위치를 확인한다.
- Produces: 없음(프롬프트·내부 로테이션만). 시그니처 불변.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('reply-composer 프롬프트에 댓글 품질 검사가 포함된다', async () => {
  const replyModule = await import('../src/modules/pipeline-a/reply-composer/index.ts');
  const { composeReply } = replyModule.default ?? replyModule;
  const provider = llm(); const original = provider.complete;
  let seen: any = null;
  provider.complete = async (req) => { seen = req; return asJson({ lead: '좌표 남겨둠👇' }); };
  try {
    await composeReply({ body: '본문', productName: '신발', deeplinkUrl: 'https://link.coupang.com/a/x', accountId: 't' } as any);
    assert.ok(seen);
    assert.match(seen.system, /본문.*(되풀이|반복)/);   // 본문 되풀이 금지
    assert.match(seen.system, /상품.*(확인|연결)/);      // 상품 확인 연결
    assert.match(seen.system, /인기|품절|효능/);          // 없는 효능/인기/품절 금지
  } finally { provider.complete = original; }
});
```

(주의: `composeReply` 실제 입력 필드명은 실행 시 파일에서 확인해 맞춘다. lead/reply 반환 형태도 확인.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --import tsx --test tests/copy-quality.test.mts`
Expected: FAIL — 현재 프롬프트에 해당 문구 없음.

- [ ] **Step 3: 최소 구현** — SYSTEM_PROMPT에 검사 규칙 추가 + 연결 멘트 로테이션.

reply-composer `SYSTEM_PROMPT` 의 "핵심 원칙:" 블록에 아래 3줄을 추가:

```
- **본문을 되풀이하지 마라.** 본문에서 이미 한 말·감탄을 반복하면 안 됨. 댓글은 새 각도로 상품 확인을 연결.
- **상품 확인으로 자연스럽게 연결.** "좌표 남겨둠", "궁금한 사람 있을까봐" 처럼 링크로 가는 명분 한 줄.
- **없는 효능·인기·품절을 덧붙이지 마라.** "다들 산다/품절대란/효과 검증" 금지.
```

연결 멘트 다양성: 상수 연결 멘트 배열을 두고 `accountId`+날짜 시드로 회전 선택(같은 멘트 연속 방지). 배열 예:

```ts
const REPLY_CONNECTORS = [
  '문의 많아서 좌표 남겨둠👇', '궁금한 사람 있을까봐 여기 둠', '정보 물어보는 분들 많아서 댓글에',
  '혹시 몰라 좌표 남겨놓음', '어디서 사냐는 댓글 많아서👇',
];
function pickConnector(seed: string): string {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return REPLY_CONNECTORS[h % REPLY_CONNECTORS.length]!;
}
```

프롬프트에 "이번 연결 멘트 톤 참고: {pickConnector(accountId)}" 로 주입(그대로 복붙 금지, 톤만).

- [ ] **Step 4: 로테이션 결정성 테스트 추가**

```ts
test('연결 멘트는 시드로 결정적으로 회전한다', async () => {
  const replyModule = await import('../src/modules/pipeline-a/reply-composer/index.ts');
  const { pickConnector } = replyModule as any;
  assert.equal(pickConnector('acctA'), pickConnector('acctA'));      // 동일 시드 = 동일
  // 서로 다른 시드가 항상 다르진 않지만, 최소 두 값 이상 존재함을 확인
  const set = new Set(['a','b','c','d','e','f','g','h'].map(pickConnector));
  assert.ok(set.size >= 2, '시드별로 여러 멘트가 선택됨');
});
```

(구현에서 `pickConnector` 를 export 한다.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --import tsx --test tests/copy-quality.test.mts`
Expected: PASS (전체).

- [ ] **Step 6: 커밋**

```bash
git add tests/copy-quality.test.mts src/modules/pipeline-a/reply-composer/index.ts
git commit -m "feat(reply-composer): 댓글 품질 검사(본문 되풀이 금지·상품연결·미확인주장 금지) + 연결 멘트 다양성

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 라이브 품질 평가 하니스 (수용 지표)

**Files:**
- Create: `scripts/eval-copy-quality.mts`
- Modify: `package.json` (scripts 에 `"eval:copy": "node --import tsx scripts/eval-copy-quality.mts"` 추가)

**Interfaces:**
- Consumes: `generateCopy`(실 LLM · factCheck 포함). LLM-judge용 `llm().complete`.
- Produces: 콘솔 리포트(카테고리별 3갭 flag rate). 저장/발행/DB 없음.

- [ ] **Step 1: 평가 스크립트 작성** — 4개 샘플 상품군에 대해 생성 후 LLM-judge로 3갭 판정.

```ts
// scripts/eval-copy-quality.mts  (실 LLM 사용 · DB/발행/텔레그램 없음)
import { generateCopy } from '../src/modules/shared/copywriter/index.ts';
import { llm } from '../src/infra/llm/index.ts';

const SAMPLES = [
  { cat:'패션·신발', productName:'오니츠카타이거 메쉬 뮬', sourceText:'この網目のミュール可愛すぎる、夏の主役', lang:'ja' },
  { cat:'뷰티·스킨케어', productName:'데이지크 포어 블러 프라이머', sourceText:'塗るだけで毛穴が消える、化粧のりが違う', lang:'ja' },
  { cat:'생활용품', productName:'무인양품 신발 클리너', sourceText:'泡つけるだけで汚れが落ちる、靴を洗濯機に入れなくていい', lang:'ja' },
  { cat:'식품', productName:'글리코 포키 딸기', sourceText:'このお菓子止まらない、いくらでも食べれる', lang:'ja' },
];

async function judge(body: string, productName: string): Promise<{ weakEnd:boolean; generic:boolean; unverified:boolean }> {
  const r = await llm().complete({
    tier:'main', thinking:'disabled', jsonMode:true,
    system:'너는 한국 쇼핑 카피 심사관이다. 아래 카피에 대해 JSON만 반환.',
    userParts:[{ type:'text', text:
`상품:${productName}\n카피:"""${body}"""\n판정(각 true=문제 있음):\n`+
`weakEnd: 끝 문장이 앞말을 반복하거나 힘이 빠졌는가\n`+
`generic: 다른 상품에도 그대로 붙는 범용 감탄으로만 끝났는가\n`+
`unverified: 없는 체험·인기·품절·효능·비교를 사실처럼 넣었는가\n`+
`{"weakEnd":bool,"generic":bool,"unverified":bool}` }],
    jsonSchema:{ type:'object', properties:{ weakEnd:{type:'boolean'}, generic:{type:'boolean'}, unverified:{type:'boolean'} }, required:['weakEnd','generic','unverified'] },
  });
  return JSON.parse(r.text.trim().replace(/^```(?:json)?/,'').replace(/```$/,''));
}

let flags = { weakEnd:0, generic:0, unverified:0 }, n = 0;
for (const s of SAMPLES) {
  for (let i=0;i<3;i++){ // 상품군당 3회
    const r = await generateCopy({ sourceText:s.sourceText, sourceLanguage:s.lang, productName:s.productName, productCategory:s.cat, personaPrompt:'20대 여성. 솔직 리액션. 반말.', accountSeed:`eval-${s.cat}-${i}`, ragEnabled:false, factCheckEnabled:true });
    const j = await judge(r.body, s.productName); n++;
    if (j.weakEnd) flags.weakEnd++; if (j.generic) flags.generic++; if (j.unverified) flags.unverified++;
    console.log(`[${s.cat}] weak:${j.weakEnd?'X':'O'} generic:${j.generic?'X':'O'} unver:${j.unverified?'X':'O'} | ${r.body.replace(/\n/g,' ')}`);
  }
}
console.log(`\n=== ${n}건 · flag rate ===`);
console.log(`밋밋/반복 마무리: ${(flags.weakEnd/n*100).toFixed(0)}% · 범용감탄: ${(flags.generic/n*100).toFixed(0)}% · 미확인주장: ${(flags.unverified/n*100).toFixed(0)}%`);
process.exit(0);
```

- [ ] **Step 2: 실행(베이스라인 측정)**

Run: `npm run eval:copy`
Expected: 각 flag rate 출력. Task 1·2 적용 후 값이 개선(낮아짐)돼야 함. (수치는 비결정적이라 목표는 "낮아짐" · 절대값 단정 X.)

- [ ] **Step 3: 커밋**

```bash
git add scripts/eval-copy-quality.mts package.json
git commit -m "chore(eval): 쇼핑 카피 3갭 라이브 평가 하니스(eval:copy)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (Track 1):**
- "밋밋한 마무리" → Task 1 본문 품질(끝 반복·힘빠짐) ✅
- "댓글 반복" → Task 2 본문 되풀이 금지 + 다양성 ✅
- "미확인 디테일(없는 체험·인기·품절·효능)" → Task 1(본문) + Task 2(댓글) ✅
- "강한 마무리 강제 금지" → Global Constraint + Task 1 Step3 ※ ✅
- "무수정 승인율 지표" → Task 3 flag rate(프록시). 실제 승인율·작업시간·폐기율은 Track 2(정정 캡처)에서 계측 → 여기선 프록시만. (Track 2 계획에서 완결)

**2. Placeholder scan:** "실행 시 파일에서 확인"(Task 2 composeReply 시그니처)은 placeholder가 아니라 기존 코드 확인 지시 — 실제 필드명은 reply-composer가 이미 존재하므로 실행자가 열어 맞춤. 나머지 코드·테스트는 실제 내용 포함.

**3. Type consistency:** `factCheckCopy`(불변), `generateCopy`(불변), `pickConnector(seed:string):string`(Task2 정의·테스트 동일), `judge`(스크립트 내부). 충돌 없음.

**주의:** 이 작업은 네이버 세션이 활발한 공유 작업트리(feature/naver-cta-button)에서 진행 중일 수 있음. shared/copywriter·reply-composer만 건드리고, 커밋 후 main 반영은 기존 방식(작업트리 커밋 → worktree cherry-pick) 따름.
