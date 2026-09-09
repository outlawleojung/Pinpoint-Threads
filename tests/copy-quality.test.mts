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
