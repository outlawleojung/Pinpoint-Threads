// 깜냥로그 브랜드 이미지 생성기 v2 — 미니멀 에디토리얼 (AI 아님, HTML→PNG).
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../../assets/naver');
await mkdir(outDir, { recursive: true });

// 채도 낮춘 웜 뉴트럴 팔레트
const BG = '#F1ECE2';
const INK = '#2C2823';
const SUB = '#8C8377';
const ACCENT = '#A9805F';
const HAIR = '#D3C9B8';
const FONT = `'Malgun Gothic','맑은 고딕',sans-serif`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

// ── 프로필 A: 미니멀 워드마크 (뱃지 없음)
await page.setViewportSize({ width: 640, height: 640 });
await page.setContent(`<!doctype html><meta charset="utf-8">
<div style="width:640px;height:640px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${BG};font-family:${FONT}">
  <div style="color:${SUB};font-size:22px;font-weight:700;letter-spacing:10px;margin-bottom:24px">LIVING JOURNAL</div>
  <div style="color:${INK};font-size:88px;font-weight:700;letter-spacing:-3px">깜냥로그</div>
  <div style="width:52px;height:2px;background:${ACCENT};margin-top:28px"></div>
</div>`);
await page.screenshot({ path: resolve(outDir, 'profile-a.png') });
console.log('wrote profile-a.png');

// ── 프로필 B: 얇은 링 모노그램
await page.setContent(`<!doctype html><meta charset="utf-8">
<div style="width:640px;height:640px;display:flex;align-items:center;justify-content:center;background:${BG};font-family:${FONT}">
  <div style="width:420px;height:420px;border:2px solid ${HAIR};border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div style="color:${INK};font-size:118px;font-weight:600;letter-spacing:-4px">깜냥</div>
    <div style="color:${ACCENT};font-size:20px;font-weight:700;letter-spacing:8px;margin-top:10px">LOG</div>
  </div>
</div>`);
await page.screenshot({ path: resolve(outDir, 'profile-b.png') });
console.log('wrote profile-b.png');

// ── 모바일 커버: 에디토리얼, 여백 중심
await page.setViewportSize({ width: 1080, height: 1440 });
await page.setContent(`<!doctype html><meta charset="utf-8">
<div style="width:1080px;height:1440px;position:relative;background:${BG};font-family:${FONT}">
  <div style="position:absolute;top:130px;left:0;right:0;text-align:center;color:${SUB};font-size:30px;font-weight:700;letter-spacing:14px">LIVING JOURNAL</div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px">
    <div style="color:${INK};font-size:150px;font-weight:700;letter-spacing:-5px;line-height:1">깜냥로그</div>
    <div style="width:64px;height:2px;background:${ACCENT};margin:52px 0"></div>
    <div style="color:${INK}dd;font-size:40px;font-weight:500;line-height:1.7">좁은 방도 예쁘고 편하게.<br>오늘의 자취 리빙을 차곡차곡.</div>
  </div>
  <div style="position:absolute;bottom:120px;left:0;right:0;text-align:center;color:${SUB};font-size:26px;font-weight:600;letter-spacing:6px">EST. 2026</div>
</div>`);
await page.screenshot({ path: resolve(outDir, 'cover-kkamnyang.png') });
console.log('wrote cover-kkamnyang.png');

await browser.close();
