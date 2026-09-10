import { prisma } from '../../src/db/prisma.js';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// 글의 각 소제목 → 핵심 요약 "정보 카드" PNG. 저작권·토큰 0 (본문 텍스트에서 추출 + HTML→PNG).
// 사용: pnpm tsx scripts/naver/make-info-cards.ts "<제목 일부>"

const BG = '#F1ECE2', INK = '#2C2823', SUB = '#8C8377', ACCENT = '#A9805F', LINE = '#D9CFBE';
const FONT = `'Malgun Gothic','맑은 고딕',sans-serif`;

// 본문에서 카드용 불릿 2~3개 추출: 숫자 포함·자기완결 문장 우선.
// 맥락 의존(이/그/여기/저처럼 앞을 가리키는) 문장은 카드에서 어색하므로 후순위.
function bullets(body: string): string[] {
  const sents = body
    .split(/(?<=[다요])\.?\s+/)
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter((s) => s.length >= 14 && s.length <= 85);
  const ctx = /^(이|그|여기|저는|저도|저처럼|그래서|반대로|이런|그런|이렇게|그렇게|위)/;
  const score = (s: string) => (/\d/.test(s) ? 2 : 0) + (ctx.test(s) ? -3 : 0);
  const ranked = [...sents].sort((a, b) => score(b) - score(a));
  return ranked.slice(0, 3);
}

async function cardsForPost(page: any, post: any, outDir: string): Promise<number> {
  const draft = post.draftJson as any;
  if (!draft?.sections?.length) return 0;
  const secs = draft.sections.slice(0, 4);
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const bs = bullets(s.body);
    const items = bs.map((b: string) => `<li style="margin:16px 0;padding-left:34px;position:relative;font-size:31px;line-height:1.55;color:${INK};word-break:keep-all">
      <span style="position:absolute;left:0;top:3px;color:${ACCENT};font-weight:800">✓</span>${b}</li>`).join('');
    const hsize = s.heading.length > 16 ? 40 : 48;
    const html = `<!doctype html><meta charset="utf-8">
    <div style="width:900px;min-height:900px;box-sizing:border-box;padding:74px 64px;background:${BG};font-family:${FONT};display:flex;flex-direction:column">
      <div style="color:${SUB};font-size:22px;font-weight:700;letter-spacing:6px">POINT ${i + 1}</div>
      <div style="color:${INK};font-size:${hsize}px;font-weight:800;line-height:1.32;margin:16px 0 28px;word-break:keep-all">${s.heading}</div>
      <div style="height:3px;width:70px;background:${ACCENT};margin-bottom:24px"></div>
      <ul style="list-style:none;padding:0;margin:0;flex:1">${items}</ul>
      <div style="border-top:1px solid ${LINE};margin-top:30px;padding-top:20px;color:${SUB};font-size:24px;font-weight:700;letter-spacing:1px">깜냥로그</div>
    </div>`;
    await page.setContent(html);
    const el = await page.$('div');
    await el!.screenshot({ path: resolve(outDir, `${post.id}-${i + 1}.png`) });
  }
  return secs.length;
}

async function main() {
  const q = process.argv[2] ?? '';
  const where = q && q !== 'all' ? { title: { contains: q } } : { state: { in: ['DRAFT', 'PLANNED', 'READY'] } };
  const posts = await prisma.naverPost.findMany({ where, orderBy: { createdAt: 'asc' } });
  if (posts.length === 0) return console.log('대상 글 없음');
  const outDir = resolve(process.cwd(), 'assets/naver/cards');
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setViewportSize({ width: 900, height: 900 });

  let total = 0;
  for (const post of posts) {
    const n = await cardsForPost(page, post, outDir);
    total += n;
    console.log(`  ${n}장  ${post.title}`);
  }
  await browser.close();
  console.log(`\n총 ${posts.length}편 → 카드 ${total}장 (${outDir})`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
