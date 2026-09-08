import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { buildPublishPackage, type PublishPackage } from '../../pipeline-d/publish-package/index.js';
import type { NaverPostDraft } from '../../pipeline-d/naver-copywriter/schema.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderPublishPage(
  post: { id: string; title: string | null; state: string; kind?: string; suggestedProduct?: string | null },
  pkg: PublishPackage,
): string {
  const suggestedProductBanner = `<div style="background:#e8f4ff;border-left:4px solid #0969da;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:.95em">
      🛒 <b>상품 링크는 소제목마다 붙일 수 있어요.</b> 아래 각 소제목의 번호를 보고, 텔레그램에서
      <code>/naverlink ${esc(post.id)} &lt;소제목번호&gt; &lt;쇼핑커넥트 링크&gt;</code> (도입 뒤는 0). 여러 번 = 여러 상품.
    </div>`;
  let headingNo = 0;
  const blocksHtml = pkg.blocks.map((b, i) => {
    if (b.type === 'HEADING') {
      headingNo += 1;
      const n = headingNo;
      const note = b.note ? `<div class="note">${esc(b.note)}</div>` : '';
      const copyBtn = `<button class="copy" data-i="${i}">복사</button>`;
      return `<div class="block HEADING">
      <div class="btype">HEADING · 소제목 ${n}${copyBtn}</div>
      ${note}
      <div class="text" id="blk-${i}">${esc(b.text)}</div>
      <div class="note" style="background:#eef2ff;border-left-color:#8899cc;color:#445">이 소제목 뒤에 상품 링크: <code>/naverlink ${esc(post.id)} ${n} &lt;쇼핑커넥트 링크&gt;</code></div>
    </div>`;
    }
    if (b.type === 'CTA') {
      const note = b.note ? `<div class="note">${esc(b.note)}</div>` : '';
      const copyBtn = `<button class="copy" data-i="${i}">복사</button>`;
      return `<div class="block ${b.type}">
      <div class="btype">${b.type}</div>
      <div style="background:#03c75a;color:#fff;font-size:1.25em;font-weight:700;text-align:center;padding:18px;border-radius:12px;margin:16px 0">
        🛒 ${esc(b.text)}
      </div>
      <div style="text-align:center;font-size:.85em;color:#555;margin-bottom:6px">
        <span class="text" id="blk-${i}">${esc(b.url ?? '')}</span> ${copyBtn}
      </div>
      ${note}
    </div>`;
    }
    if (b.type === 'IMAGE') {
      const img = b.imageUrl ? `<img src="${esc(b.imageUrl)}" style="max-width:220px;border-radius:8px;display:block;margin:0 auto 10px">` : '';
      const label = b.imageUrl ? '📷 여기에 이미지' : '📷 여기에 이미지 넣기';
      const note = b.note ? `<div class="note">${esc(b.note)}</div>` : '';
      return `<div class="block ${b.type}">
      <div class="btype">${b.type}</div>
      <div style="border:2px dashed #bbb;border-radius:10px;padding:16px;background:#fbfbfb;text-align:center;color:#555;margin:12px 0">
        ${img}
        <div style="font-weight:700">${label}</div>
        <div class="text" id="blk-${i}" style="margin-top:6px">${esc(b.text)}</div>
      </div>
      ${note}
    </div>`;
    }
    const img = b.imageUrl ? `<img src="${esc(b.imageUrl)}" style="max-width:220px;border-radius:8px;display:block;margin:8px 0">` : '';
    const note = b.note ? `<div class="note">${esc(b.note)}</div>` : '';
    const copyBtn = `<button class="copy" data-i="${i}">복사</button>`;
    return `<div class="block ${b.type}">
      <div class="btype">${b.type}${copyBtn}</div>
      ${note}
      <div class="text" id="blk-${i}">${esc(b.text)}</div>
      ${img}
    </div>`;
  }).join('\n');

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>발행 · ${esc(post.title ?? post.id)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#222}
.block{border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px;margin:12px 0;background:#fafafa}
.btype{font-size:.72em;color:#888;letter-spacing:.05em;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
.text{white-space:pre-wrap;line-height:1.65}
.note{background:#fff6e5;border-left:3px solid #f0ad4e;padding:6px 10px;font-size:.82em;color:#8a6d3b;margin-bottom:8px;border-radius:4px}
.HEADING .text{font-weight:700;font-size:1.15em}
.TITLE .text{font-weight:700;font-size:1.35em}
.copy{font-size:.8em;padding:3px 10px;border:1px solid #0969da;background:#fff;color:#0969da;border-radius:5px;cursor:pointer}
.copy:hover{background:#0969da;color:#fff}
.done{margin-top:24px}
.done button{padding:10px 18px;background:#1a7f37;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:.95em}
</style></head><body>
<h1>${esc(post.title ?? '(제목 미정)')}</h1>
<p style="color:#888">state: ${post.state} · 블록별 복사 → 네이버 에디터 붙여넣기. 소제목은 에디터에서 "제목2" 스타일 지정, 이미지는 표시 순서대로 삽입.</p>
${suggestedProductBanner}
${blocksHtml}
<form class="done" method="POST" action="/admin/naver/${post.id}/published">
  <button type="submit">✅ 발행 완료로 표시</button>
</form>
<script>
document.querySelectorAll('.copy').forEach((btn) => {
  btn.addEventListener('click', () => {
    const i = btn.getAttribute('data-i');
    const t = document.getElementById('blk-' + i).innerText;
    navigator.clipboard.writeText(t).then(() => { btn.textContent = '복사됨'; setTimeout(() => btn.textContent = '복사', 1200); });
  });
});
</script></body></html>`;
}

function renderList(rows: Array<{ id: string; title: string | null; state: string; kind: string; createdAt: Date }>): string {
  const items = rows.map((r) => `<li><a href="/admin/naver/${r.id}">${esc(r.title ?? r.id)}</a> <span style="color:#999">· ${r.kind} · ${r.state}</span></li>`).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>네이버 발행 대기</title>
<style>body{font-family:-apple-system,sans-serif;max-width:720px;margin:32px auto;padding:0 16px}li{margin:8px 0}</style></head>
<body><h1>네이버 블로그 · 발행 대기</h1><ul>${items || '<p>대기 중인 원고 없음</p>'}</ul></body></html>`;
}

export async function registerNaverRoutes(app: AnyFastify): Promise<void> {
  app.get('/admin/naver', async (_req, reply) => {
    const rows = await prisma.naverPost.findMany({
      where: { state: { in: ['PLANNED', 'READY'] } }, orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, state: true, kind: true, createdAt: true },
    });
    return reply.type('text/html').send(renderList(rows));
  });

  app.get('/admin/naver/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const post = await prisma.naverPost.findUnique({ where: { id } });
    if (!post || !post.draftJson) return reply.code(404).send('not found');
    const pkg = buildPublishPackage(post.draftJson as unknown as NaverPostDraft, post.imageUrls, {
      includeDisclaimer: post.kind !== 'INFO',
      connectUrl: post.connectUrl ?? undefined,
    });
    return reply.type('text/html').send(renderPublishPage(post, pkg));
  });

  app.post('/admin/naver/:id/published', async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.naverPost.update({ where: { id }, data: { state: 'PUBLISHED', publishedAt: new Date() } });
    return reply.redirect('/admin/naver');
  });
}
