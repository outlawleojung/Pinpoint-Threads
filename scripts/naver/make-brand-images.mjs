// 깜냥로그 브랜드 이미지 생성기 (AI 아님, HTML→PNG). 프로필 + 모바일 커버.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../../assets/naver');
await mkdir(outDir, { recursive: true });

const CREAM = '#F7EEDD';
const CREAM2 = '#EFE0C6';
const INK = '#3A2B22';
const TERRA = '#C4623C';
const MUSTARD = '#D69A3C';

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

// 1) 프로필 (정사각, 원형 크롭 대비 중앙 여백)
await page.setViewportSize({ width: 640, height: 640 });
await page.setContent(`<!doctype html><meta charset="utf-8">
<div style="width:640px;height:640px;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 50% 38%, ${CREAM} 0%, ${CREAM2} 100%);
  font-family:'Malgun Gothic','맑은 고딕',sans-serif">
  <div style="text-align:center">
    <div style="width:210px;height:210px;margin:0 auto 26px;border-radius:50%;
      background:${TERRA};display:flex;align-items:center;justify-content:center;
      box-shadow:0 8px 24px rgba(60,40,30,.18)">
      <span style="color:#fff;font-size:120px;font-weight:900;letter-spacing:-4px">깜</span>
    </div>
    <div style="color:${INK};font-size:64px;font-weight:900;letter-spacing:-2px">깜냥로그</div>
    <div style="color:${TERRA};font-size:26px;font-weight:700;letter-spacing:6px;margin-top:6px">RETRO LIVING</div>
  </div>
</div>`);
await page.screenshot({ path: resolve(outDir, 'profile-kkamnyang.png') });
console.log('wrote profile-kkamnyang.png');

// 2) 모바일 커버 (세로형)
await page.setViewportSize({ width: 1080, height: 1440 });
await page.setContent(`<!doctype html><meta charset="utf-8">
<div style="width:1080px;height:1440px;position:relative;overflow:hidden;
  background:linear-gradient(160deg, ${CREAM} 0%, ${CREAM2} 60%, ${MUSTARD}33 100%);
  font-family:'Malgun Gothic','맑은 고딕',sans-serif">
  <!-- 레트로 라인 프레임 -->
  <div style="position:absolute;inset:48px;border:3px solid ${TERRA}55;border-radius:18px"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px">
    <div style="width:150px;height:150px;border-radius:50%;background:${TERRA};display:flex;align-items:center;justify-content:center;margin-bottom:40px;box-shadow:0 10px 28px rgba(60,40,30,.2)">
      <span style="color:#fff;font-size:86px;font-weight:900">깜</span>
    </div>
    <div style="color:${INK};font-size:104px;font-weight:900;letter-spacing:-3px">깜냥로그</div>
    <div style="width:120px;height:5px;background:${MUSTARD};border-radius:3px;margin:34px 0"></div>
    <div style="color:${INK}cc;font-size:40px;font-weight:600;line-height:1.5">내 깜냥껏, 오늘의 자취 리빙<br>좁은 방도 예쁘고 편하게</div>
  </div>
</div>`);
await page.screenshot({ path: resolve(outDir, 'cover-kkamnyang.png') });
console.log('wrote cover-kkamnyang.png');

await browser.close();
