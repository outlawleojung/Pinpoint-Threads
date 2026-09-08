/** Live copy-only smoke check. No DB writes, media upload, Telegram, or publishing. */
import { writeFile } from 'node:fs/promises';

if (!process.argv.includes('--live')) {
  console.error('Usage: node --import tsx scripts/verify-source-preserving-copy.mts --live [--out path.json]');
  process.exit(1);
}
process.env.LOG_LEVEL = 'error';
const copyModule = await import('../src/modules/shared/copywriter/index.ts');
const replyModule = await import('../src/modules/pipeline-a/reply-composer/index.ts');
const { generateCopy, factCheckCopy } = copyModule.default ?? copyModule;
const { composeReply } = replyModule.default ?? replyModule;

const sourceText = 'スタバで仲良し美女2人がお揃いで履いてたコレ\nめっちゃ可愛くてガン見しちゃった…\nオールブラックでこんなかわいいの初めてで';
const started = Date.now();
const copy = await generateCopy({
  sourceText, productName: '아디다스 오즈가이아 검정 운동화', productCategory: '신발',
  personaPrompt: '담백한 반말. 실제 장면에 붙는 짧은 혼잣말.',
  accountSeed: 'offline-source-preservation-check', ragEnabled: false,
});
// A real observed failure: dropping the subject still reads as the publisher's personal experience.
const knownBadReview = await factCheckCopy({
  body: '스타벅스에서 커플로 같은 신발 신은 미녀 두 명 보고 나도 모르게 계속 쳐다봄',
  sourceBrief: copy.sourceBrief, sourceText,
  productName: '아디다스 오즈가이아 검정 운동화',
});
if (knownBadReview.ok) throw new Error('Live regression failed: the reviewer accepted a copied personal eyewitness story');
const reply = await composeReply({
  body: copy.body, sourceBrief: copy.sourceBrief, sourceText,
  productName: '아디다스 오즈가이아 검정 운동화', productCategory: '신발',
  accountId: 'offline-source-preservation-check', deeplinkUrl: 'https://example.com/test-only',
});
const result = {
  checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
  scope: 'text-only live generation; no images inspected, no publication, no revenue validation',
  sourceText, sourceBrief: copy.sourceBrief, body: copy.body, replyLead: reply.lead, knownBadReview,
};
const outputIndex = process.argv.indexOf('--out');
if (outputIndex !== -1) {
  const path = process.argv[outputIndex + 1];
  if (!path) throw new Error('--out requires a path');
  await writeFile(path, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
