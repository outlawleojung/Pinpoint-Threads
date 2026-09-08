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

const briefModule = await import('../src/modules/shared/copywriter/source-brief.ts');
const { analyzeSource, validateSourceBrief } = briefModule.default ?? briefModule;
const copyModule = await import('../src/modules/shared/copywriter/index.ts');
const { generateCopy, generateBodyVariants, factCheckCopy } = copyModule.default ?? copyModule;
const replyModule = await import('../src/modules/pipeline-a/reply-composer/index.ts');
const { composeReply, LEGAL_DISCLAIMER } = replyModule.default ?? replyModule;
const llmModule = await import('../src/infra/llm/index.ts');
const { llm } = llmModule.default ?? llmModule;

const sourceText = 'Two people wore matching black shoes. I kept looking at the shape.';
const brief = {
  situation: '원작자가 두 사람의 같은 검정 신발을 보고 형태에 시선이 갔다.',
  points: [{ fact: '두 사람이 같은 검정 신발을 신었다.', evidenceType: 'source_text', evidence: 'Two people wore matching black shoes.' }],
  focusIndex: 0,
  allowedChanges: ['한국어 말투와 호흡'],
  unknowns: ['게시 계정의 착용 경험', '쿠션감과 키높이 효과'],
};
const response = (value: unknown) => ({ text: JSON.stringify(value), provider: 'gemini', model: 'test' });

test('reject invented quotations, absent media, and invalid focus references', () => {
  assert.deepEqual(validateSourceBrief(brief, { sourceText }), brief);
  assert.throws(() => validateSourceBrief({ ...brief, focusIndex: 2 }, { sourceText }));
  assert.throws(() => validateSourceBrief({ ...brief, points: [{ ...brief.points[0], evidence: '성수에서 신어봄' }] }, { sourceText }));
  assert.throws(() => validateSourceBrief({ ...brief, points: [{ ...brief.points[0], evidenceType: 'provided_image' }] }, { sourceText }));
  assert.throws(() => validateSourceBrief({ ...brief, points: [{ ...brief.points[0], evidenceType: 'media_description' }] }, { sourceText }));
});

test('analysis retries invalid evidence once and never silently substitutes a fabricated brief', async () => {
  let calls = 0;
  const result = await analyzeSource({ sourceText }, async () => response(++calls === 1 ? { ...brief, focusIndex: 99 } : brief));
  assert.equal(calls, 2);
  assert.deepEqual(result, brief);
  calls = 0;
  await assert.rejects(() => analyzeSource({ sourceText }, async () => { calls++; return response({}); }), /원본 보존 기준/);
  assert.equal(calls, 2);
});

test('empty input stops before invoking the model', async () => {
  await assert.rejects(() => analyzeSource({}, async () => assert.fail('must not call model')), /requires original/);
});

test('media descriptions require verbatim evidence and remain distinct from images', async () => {
  const description = '손가락 앞에 금속판을 대고 칼질한다.';
  const described = { ...brief, points: [{ fact: description, evidenceType: 'media_description', evidence: description }] };
  const result = await analyzeSource({ sourceMediaDescription: description }, async (request) => {
    assert.equal(request.userParts.filter((p) => p.type === 'image').length, 0);
    return response(described);
  });
  assert.equal(result.points[0].evidenceType, 'media_description');
});

test('body and reply retries share the original brief; disclosures survive', async () => {
  const provider = llm();
  const original = provider.complete;
  const calls: any[] = [];
  const outputs = [brief,
    { body: '성수에서 직접 신어보니 키 커짐' }, { ok: false, reason: '없는 장소와 착용 경험' },
    { body: '둘이 똑같이 신으니까 더 눈에 들어오네' }, { ok: true },
    { lead: '신어보니 쿠션감도 좋더라' }, { ok: false, reason: '확인되지 않은 체험과 쿠션감' },
    { lead: '같이 신으니까 더 눈에 띄네' }, { ok: true }];
  provider.complete = async (request) => { calls.push(request); assert.ok(outputs.length); return response(outputs.shift()); };
  try {
    const copy = await generateCopy({ sourceText, productName: '검정 운동화', accountSeed: 'test', ragEnabled: false });
    const reply = await composeReply({ body: copy.body, productName: '검정 운동화', accountId: 'test',
      sourceBrief: copy.sourceBrief, sourceText, deeplinkUrl: 'https://example.com/test', channel: 'COUPANG' });
    assert.equal(outputs.length, 0);
    assert.equal(calls.length, 9);
    assert.deepEqual(copy.sourceBrief, brief);
    for (const index of [1, 3, 5, 7]) {
      assert.ok(JSON.stringify(calls[index].userParts).includes(brief.situation));
    }
    assert.ok(JSON.stringify(calls[3].userParts).includes('없는 장소와 착용 경험'));
    assert.ok(JSON.stringify(calls[7].userParts).includes('확인되지 않은 체험과 쿠션감'));
    assert.ok(reply.text.startsWith('[광고]'));
    assert.ok(reply.text.includes(LEGAL_DISCLAIMER));
    assert.ok(reply.text.includes('https://example.com/test'));
  } finally { provider.complete = original; }
});

test('source-aware reviewer failure cannot pass unverified copy', async () => {
  const provider = llm();
  const original = provider.complete;
  provider.complete = async () => { throw new Error('simulated unavailable reviewer'); };
  try {
    await assert.rejects(() => factCheckCopy({ body: '신어봤는데 정말 편하네', sourceBrief: brief, sourceText }), /원본 보존 검사/);
  } finally { provider.complete = original; }
});

test('variants reuse one source analysis rather than inventing a new story per candidate', async () => {
  const provider = llm();
  const original = provider.complete;
  const outputs = [brief, { body: '둘이 똑같은 검정 신발이네' }, { body: '같이 신으니까 더 눈에 들어오네' }];
  let calls = 0;
  provider.complete = async () => { calls++; return response(outputs.shift()); };
  try {
    const result = await generateBodyVariants({ sourceText, accountSeed: 'test', ragEnabled: false }, 2);
    assert.equal(result.length, 2);
    assert.equal(calls, 3);
  } finally { provider.complete = original; }
});
