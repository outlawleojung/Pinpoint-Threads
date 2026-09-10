import { prisma } from '../../src/db/prisma.js';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// 글의 각 소제목 → 핵심 요약 "정보 카드" PNG. 저작권·토큰 0 (본문 텍스트에서 추출 + HTML→PNG).
// 사용: pnpm tsx scripts/naver/make-info-cards.ts "<제목 일부>"

const BG = '#F1ECE2', INK = '#2C2823', SUB = '#8C8377', ACCENT = '#A9805F', LINE = '#D9CFBE';
const FONT = `'Malgun Gothic','맑은 고딕',sans-serif`;

// 본문에서 카드용 불릿 2~3개 추출: 숫자 포함 문장 우선, 없으면 앞 문장.
function bullets(body: string): string[] {
  const sents = body.split(/(?<=[다요])\.?\s+/).map((s) => s.trim()).filter((s) => s.length >= 8 && s.length <= 90);
  const withNum = sents.filter((s) => /\d/.test(s));
  const picked = [...withNum, ...sents.filter((s) => !withNum.includes(s))].slice(0, 3);
  return picked.map((s) => s.replace(/\.$/, ''));
}

async function main() {
  const q = process.argv[2] ?? '';
  const post = await prisma.naverPost.findFirst({ where: q ? { title: { contains: q } } : {}, orderBy: { createdAt: 'desc' } });
  if (!post) return console.log('글 없음');
  const draft = post.draftJson as any;
  const outDir = resolve(process.cwd(), 'assets/naver/cards');
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setViewportSize({ width: 900, height: 900 });

  const files: string[] = [];
  const secs = draft.sections.slice(0, 4);
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const bs = bullets(s.body);
    const items = bs.map((b: string) => `<li style="margin:14px 0;padding-left:30px;position:relative;font-size:30px;line-height:1.5;color:${INK}">
      <span style="position:absolute;left:0;top:2px;color:${ACCENT};font-weight:800">✓</span>${b}</li>`).join('');
    const html = `<!doctype html><meta charset="utf-8">
    <div style="width:900px;min-height:900px;box-sizing:border-box;padding:70px 64px;background:${BG};font-family:${FONT};display:flex;flex-direction:column">
      <div style="color:${SUB};font-size:22px;font-weight:700;letter-spacing:6px">POINT ${i + 1}</div>
      <div style="color:${INK};font-size:46px;font-weight:800;line-height:1.3;margin:14px 0 30px">${s.heading}</div>
      <div style="height:3px;width:70px;background:${ACCENT};margin-bottom:20px"></div>
      <ul style="list-style:none;padding:0;margin:0;flex:1">${items}</ul>
      <div style="border-top:1px solid ${LINE};margin-top:30px;padding-top:20px;color:${SUB};font-size:24px;font-weight:700">깜냥로그</div>
    </div>`;
    await page.setContent(html);
    const el = await page.$('div');
    const file = resolve(outDir, `${post.id}-${i + 1}.png`);
    await el!.screenshot({ path: file });
    files.push(file);
    console.log('wrote', file);
  }
  await browser.close();
  console.log(`\n"${post.title}" → 카드 ${files.length}장`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
