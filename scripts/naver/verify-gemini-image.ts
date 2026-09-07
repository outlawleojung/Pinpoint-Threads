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
