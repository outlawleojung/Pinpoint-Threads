import assert from 'node:assert/strict';
import { test } from 'node:test';

// No network, real credentials, DB queries, or Telegram actions in these tests.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
process.env.TELEGRAM_BOT_TOKEN = 'test';
process.env.TELEGRAM_ADMIN_CHAT_ID = '1';
process.env.ANTHROPIC_API_KEY = 'test';
process.env.GEMINI_API_KEY = 'test';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters';
process.env.LOG_LEVEL = 'error';

const copyModule = await import('../src/modules/shared/copywriter/index.ts');
const { factCheckCopy, generateCopy } = copyModule.default ?? copyModule;
const replyModule = await import('../src/modules/pipeline-a/reply-composer/index.ts');
const { composeReply, pickConnector } = replyModule.default ?? replyModule;
const llmModule = await import('../src/infra/llm/index.ts');
const { llm } = llmModule.default ?? llmModule;

const asJson = (v: unknown) => ({ text: JSON.stringify(v), provider: 'test', model: 'test' });

test('factCheck 프롬프트에 본문 품질 검사 항목이 포함된다', async () => {
  const provider = llm();
  const original = provider.complete;
  let seen: any = null;
  provider.complete = async (req: any) => { seen = req; return asJson({ ok: true, reason: '' }); };
  try {
    await factCheckCopy({ body: '아무 본문', productName: '신발' });
    assert.ok(seen, 'complete 호출됨');
    assert.match(seen.system, /본문 품질/);
    assert.match(seen.system, /끝[\s\S]*?(반복|힘)/); // 마무리 반복/힘빠짐 검사
    assert.match(seen.system, /인기|품절|효능/); // 미확인 주장 검사
  } finally {
    provider.complete = original;
  }
});

test('본문 품질 실패 시 generateCopy가 재생성한다', async () => {
  const provider = llm();
  const original = provider.complete;
  const brief = {
    situation: 's',
    points: [{ fact: 'f', evidenceType: 'source_text', evidence: 'x' }],
    focusIndex: 0,
    allowedChanges: ['한국어 말투'],
    unknowns: [],
  };
  // 순서: analyzeSource(brief) → body1(약함) → verdict(ok:false) → body2(좋음) → verdict(ok:true)
  const outputs: unknown[] = [
    brief,
    { body: '약한 본문 약한 본문' },
    { ok: false, reason: '끝 반복' },
    { body: '좋은 본문임' },
    { ok: true, reason: '' },
  ];
  provider.complete = async () => asJson(outputs.shift());
  try {
    const r = await generateCopy({ sourceText: 'x', productName: '신발', accountSeed: 't', ragEnabled: false, factCheckEnabled: true });
    assert.equal(r.body, '좋은 본문임'); // 재생성본 채택
  } finally {
    provider.complete = original;
  }
});

test('reply-composer 프롬프트에 댓글 품질 검사가 포함된다', async () => {
  const provider = llm();
  const original = provider.complete;
  let seen: any = null;
  provider.complete = async (req: any) => { seen = req; return asJson({ lead: '좌표 남겨둠' }); };
  try {
    await composeReply({ body: '본문', productName: '신발', deeplinkUrl: 'https://link.coupang.com/a/x', accountId: 't' } as any);
    assert.ok(seen);
    assert.match(seen.system, /본문[\s\S]*?(되풀이|반복)/); // 본문 되풀이 금지
    assert.match(seen.system, /상품[\s\S]*?(확인|연결)/); // 상품 확인 연결
    assert.match(seen.system, /인기|품절|효능/); // 없는 효능/인기/품절 금지
  } finally {
    provider.complete = original;
  }
});

test('연결 멘트는 시드로 결정적으로 회전한다', async () => {
  assert.equal(pickConnector('acctA'), pickConnector('acctA')); // 동일 시드 = 동일
  const set = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(pickConnector));
  assert.ok(set.size >= 2, '시드별로 여러 멘트가 선택됨');
});
