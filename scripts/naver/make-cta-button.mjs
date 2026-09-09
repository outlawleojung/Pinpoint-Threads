// "상품 확인하러 가기" CTA 버튼 이미지 생성기 (AI 아님, HTML→PNG 렌더).
// 네이버 블로그 에디터에 이미지로 삽입 후, 그 이미지에 쇼핑커넥트 링크를 걸어 재사용.
// 실행: pnpm tsx 아님 → node scripts/naver/make-cta-button.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../../assets/naver');
await mkdir(outDir, { recursive: true });

const NAVER_GREEN = '#03C75A';

// 라벨은 인자로 바꿀 수 있게 (기본: 상품 확인하러 가기)
const label = process.argv[2] ?? '상품 확인하러 가기';

const variants = [
  {
    name: 'cta-green',
    css: `background:${NAVER_GREEN};color:#fff;`,
    icon: '🛒',
  },
  {
    name: 'cta-outline',
    css: `background:#fff;color:${NAVER_GREEN};border:3px solid ${NAVER_GREEN};`,
    icon: '🛒',
  },
  {
    name: 'cta-dark',
    css: `background:#111;color:#fff;`,
    icon: '👉',
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 }); // 레티나급 2배 해상도

for (const v of variants) {
  const html = `<!doctype html><meta charset="utf-8">
  <div id="btn" style="
    display:inline-flex;flex-direction:column;align-items:center;gap:6px;
    font-family:'Malgun Gothic','맑은 고딕',sans-serif;
    font-size:32px;font-weight:800;letter-spacing:-0.5px;
    padding:20px 48px 14px;border-radius:16px;
    box-shadow:0 4px 14px rgba(0,0,0,.12);
    ${v.css}
  ">
    <span style="display:inline-flex;align-items:center;gap:12px">
      <span style="font-size:34px">${v.icon}</span>
      <span>${label}</span>
    </span>
    <span style="font-size:30px;line-height:.7;transform:scaleX(1.6)">⌄</span>
  </div>`;
  await page.setContent(html);
  const el = await page.$('#btn');
  const out = resolve(outDir, `${v.name}.png`);
  await el.screenshot({ path: out, omitBackground: true }); // 투명 배경
  console.log('wrote', out);
}

await browser.close();
