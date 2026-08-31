import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { ingestUrl } from '../url-ingester/index.js';
import { InboundSource, InboundStatus } from '@prisma/client';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * InboundLink 관리 UI.
 * - 유입된 URL 목록 (Lane 1 텔레그램 + Lane 2 자율 트렌드 공통)
 * - 상세: 원본 텍스트·미디어·언어·상태
 * - 상태별 필터
 * - 실패한 인제스트 재시도
 */

export async function registerInboundRoutes(app: AnyFastify): Promise<void> {
  app.get<{ Querystring: { status?: string; platform?: string; source?: string } }>(
    '/admin/inbound',
    async (req, reply) => {
      const { status, platform, source } = req.query;
      const where: any = {};
      if (status) where.status = status;
      if (platform) where.platform = platform;
      if (source) where.source = source;

      const [rows, total] = await Promise.all([
        prisma.inboundLink.findMany({
          where,
          orderBy: { receivedAt: 'desc' },
          take: 100,
        }),
        prisma.inboundLink.count({ where }),
      ]);

      const statusCounts = await prisma.inboundLink.groupBy({
        by: ['status'],
        _count: true,
      });

      const trList = rows
        .map((r) => {
          const short = (r.rawText ?? '').slice(0, 60).replace(/\s+/g, ' ');
          const statusClass = statusClassOf(r.status);
          return `
        <tr>
          <td><span class="badge">${escape(r.platform)}</span></td>
          <td><span class="src ${r.source === 'MANUAL_TELEGRAM' ? 'manual' : 'auto'}">${r.source === 'MANUAL_TELEGRAM' ? '수동' : '자율'}</span></td>
          <td><span class="status ${statusClass}">${escape(r.status)}</span></td>
          <td>${escape(r.authorHandle ?? '-')}</td>
          <td>${escape(r.rawLanguage ?? '-')}</td>
          <td>${r.mediaUrls.length}</td>
          <td class="text">${escape(short) || '<span class="muted">-</span>'}</td>
          <td>${r.receivedAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
          <td><a href="/admin/inbound/${escape(r.id)}">상세</a></td>
        </tr>`;
        })
        .join('');

      const statusChips = statusCounts
        .map(
          (s) =>
            `<a href="/admin/inbound?status=${escape(s.status)}" class="chip ${statusClassOf(s.status)}">
              ${escape(s.status)} <strong>${s._count}</strong>
            </a>`,
        )
        .join(' ');

      return reply.type('text/html').send(
        renderPage(
          '유입된 URL (InboundLink)',
          `
        <p>총 ${total}건 (필터 적용 후, 최대 100건 표시).</p>
        <div class="chips">
          <a href="/admin/inbound" class="chip">전체</a>
          ${statusChips}
        </div>
        <table>
          <thead><tr>
            <th>Platform</th><th>Source</th><th>Status</th>
            <th>Author</th><th>Lang</th><th>M</th><th>Text</th><th>Received</th><th></th>
          </tr></thead>
          <tbody>${trList || '<tr><td colspan="9" class="muted">아직 유입 없음</td></tr>'}</tbody>
        </table>
        `,
        ),
      );
    },
  );

  app.get<{ Params: { id: string } }>('/admin/inbound/:id', async (req, reply) => {
    const link = await prisma.inboundLink.findUnique({ where: { id: req.params.id } });
    if (!link) return reply.code(404).type('text/html').send(renderPage('없음', '해당 InboundLink 없음'));

    const engagement = link.engagement ? JSON.stringify(link.engagement, null, 2) : '{}';
    const mediaList = link.mediaUrls
      .map((u) => `<li><a href="${escape(u)}" target="_blank">${escape(u)}</a></li>`)
      .join('');

    return reply.type('text/html').send(
      renderPage(
        `InboundLink · ${link.platform}`,
        `
        <dl>
          <dt>ID</dt><dd><code>${escape(link.id)}</code></dd>
          <dt>URL</dt><dd><a href="${escape(link.url)}" target="_blank">${escape(link.url)}</a></dd>
          <dt>Normalized</dt><dd><code>${escape(link.normalizedUrl)}</code></dd>
          <dt>Platform · Source · Status</dt><dd>
            <span class="badge">${escape(link.platform)}</span>
            <span class="badge">${escape(link.source)}</span>
            <span class="status ${statusClassOf(link.status)}">${escape(link.status)}</span>
          </dd>
          <dt>Author</dt><dd>${escape(link.authorHandle ?? '-')}</dd>
          <dt>Language</dt><dd>${escape(link.rawLanguage ?? '-')}</dd>
          <dt>Published</dt><dd>${link.publishedAt?.toISOString() ?? '-'}</dd>
          <dt>Received</dt><dd>${link.receivedAt.toISOString()}</dd>
        </dl>

        <h2>본문</h2>
        <pre>${escape(link.rawText ?? '(없음)')}</pre>

        <h2>미디어 (${link.mediaUrls.length})</h2>
        <ul>${mediaList || '<li class="muted">없음</li>'}</ul>

        <h2>Engagement</h2>
        <pre>${escape(engagement)}</pre>

        ${link.errorMessage ? `<h2>에러</h2><pre class="err">${escape(link.errorMessage)}</pre>` : ''}

        <div class="actions">
          <form method="POST" action="/admin/inbound/${escape(link.id)}/reingest" style="display:inline">
            <button type="submit">🔄 재인제스트</button>
          </form>
          <a href="/admin/inbound">← 목록으로</a>
        </div>
      `,
      ),
    );
  });

  app.post<{ Params: { id: string } }>('/admin/inbound/:id/reingest', async (req, reply) => {
    const link = await prisma.inboundLink.findUnique({ where: { id: req.params.id } });
    if (!link) return reply.code(404).type('text/html').send(renderPage('없음', 'InboundLink 없음'));

    // dedup 키(normalizedUrl) 살아있으므로, 삭제 후 재인제스트
    await prisma.inboundLink.delete({ where: { id: link.id } });
    const result = await ingestUrl({ url: link.url, source: InboundSource.MANUAL_TELEGRAM });

    return reply
      .type('text/html')
      .send(
        renderPage(
          '재인제스트',
          `<p>${escape(result.message)}</p>
           <p>새 상태: ${escape(result.status)}</p>
           <p><a href="/admin/inbound/${escape(result.inboundLinkId)}">새 InboundLink 상세</a> · <a href="/admin/inbound">목록</a></p>`,
        ),
      );
  });
}

function statusClassOf(status: string): string {
  switch (status) {
    case InboundStatus.FETCHED:
    case InboundStatus.READY_FOR_APPROVAL:
    case InboundStatus.APPROVED:
    case InboundStatus.PUBLISHED:
      return 'ok';
    case InboundStatus.FAILED:
    case InboundStatus.REJECTED:
      return 'err';
    case InboundStatus.FETCHING:
    case InboundStatus.CLASSIFYING:
    case InboundStatus.MATCHING:
      return 'pending';
    default:
      return '';
  }
}

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>${escape(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:1200px;margin:32px auto;padding:0 20px;color:#222;line-height:1.5}
h1{margin-bottom:16px}
h2{margin-top:32px;font-size:1.1em;color:#555}
table{width:100%;border-collapse:collapse;font-size:0.85em}
th,td{padding:6px 8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{background:#fafafa;font-weight:600}
.text{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#555}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;background:#e3f2fd;color:#0d47a1;font-size:0.72em;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
.src.manual{background:#fff3e0;color:#e65100;padding:1px 6px;border-radius:3px;font-size:0.72em}
.src.auto{background:#e8f5e9;color:#1b5e20;padding:1px 6px;border-radius:3px;font-size:0.72em}
.status{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.72em;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
.status.ok{background:#c8e6c9;color:#1b5e20}
.status.err{background:#ffcdd2;color:#c62828}
.status.pending{background:#fff9c4;color:#f57f17}
.muted{color:#999}.err{color:#c00}
.chips{margin:12px 0;display:flex;gap:8px;flex-wrap:wrap}
.chip{display:inline-block;padding:4px 10px;background:#f0f0f0;color:#333;border-radius:12px;font-size:0.85em;text-decoration:none}
.chip.ok{background:#c8e6c9;color:#1b5e20}
.chip.err{background:#ffcdd2;color:#c62828}
.chip.pending{background:#fff9c4;color:#f57f17}
.chip strong{margin-left:4px}
dl{display:grid;grid-template-columns:180px 1fr;gap:6px 12px;margin:16px 0}
dt{font-weight:600;color:#666}
dd{margin:0}
pre{background:#f4f4f4;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:0.85em;overflow-x:auto}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:0.85em}
.actions{margin:20px 0;display:flex;gap:12px;align-items:center}
button{padding:8px 14px;background:#0969da;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.95em}
button:hover{background:#0860c7}
a{color:#0969da}
</style>
</head><body>
<h1>${escape(title)}</h1>
${bodyHtml}
<hr style="margin-top:40px">
<p><a href="/admin">← Admin 홈</a></p>
</body></html>`;
}

function escape(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
