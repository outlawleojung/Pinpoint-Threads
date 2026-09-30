/**
 * 강의 사례 라이브러리(lecture-cases.json) 임베딩 → lecture-cases.emb.bin (Float32, 사례 순서 동일).
 * 라이브러리가 바뀌면 다시 실행: npx tsx scripts/build-lecture-case-embeddings.mts
 */
import { readFileSync, writeFileSync } from 'fs';
import { embed, VOYAGE_DIM } from '../src/infra/voyage-client.js';

const DIR = 'src/modules/shared/copywriter/data';
const cases = JSON.parse(readFileSync(`${DIR}/lecture-cases.json`, 'utf-8')) as any[];
const docOf = (c: any) =>
  [c.subject && `소재: ${c.subject}`, `글: ${c.text}`, c.applies_when && `맞는 상황: ${c.applies_when}`, c.why && `이유: ${c.why}`]
    .filter(Boolean).join('\n');
const out = new Float32Array(cases.length * VOYAGE_DIM);
let tokens = 0;
// Voyage 무결제 한도(3 RPM · 10K TPM) → 작은 배치 + 25초 간격 + 429 재시도
const B = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < cases.length; i += B) {
  const batch = cases.slice(i, i + B);
  let res: Awaited<ReturnType<typeof embed>> | null = null;
  for (let t = 0; !res; t++) {
    try { res = await embed({ texts: batch.map(docOf), inputType: 'document' }); }
    catch (e) { if (t > 6) throw e; console.log('rate limited · wait'); await sleep(30000); }
  }
  const { embeddings, totalTokens } = res;
  await sleep(21000);
  tokens += totalTokens;
  embeddings.forEach((e, j) => out.set(e, (i + j) * VOYAGE_DIM));
  console.log('embedded', Math.min(i + B, cases.length), '/', cases.length);
}
writeFileSync(`${DIR}/lecture-cases.emb.bin`, Buffer.from(out.buffer));
console.log('done · tokens', tokens, '· bytes', out.byteLength);
process.exit(0);
