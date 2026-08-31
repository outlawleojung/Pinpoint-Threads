import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { generateBody } from '../copywriter/persona-preview.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * 계정별 페르소나 관리 UI.
 * - 5계정 리스트, 각 계정 personaPrompt 편집
 * - 프리뷰: 임의 원문(다국어 지원)으로 각 계정의 카피가 어떻게 나오는지 미리보기
 */

export async function registerPersonaRoutes(app: AnyFastify): Promise<void> {
  app.get('/admin/personas', async (_req, reply) => {
    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        handle: true,
        personaPrompt: true,
        isActive: true,
        tokenExpiresAt: true,
      },
    });

    const rows = accounts
      .map(
        (a) => `
      <details ${a.isActive ? 'open' : ''}>
        <summary>
          <strong>${escape(a.handle)}</strong>
          <span class="badge ${a.isActive ? 'ok' : 'off'}">${a.isActive ? '활성' : '비활성'}</span>
          <span class="muted">${a.tokenExpiresAt ? '토큰 ~' + a.tokenExpiresAt.toISOString().slice(0, 10) : '토큰 없음'}</span>
        </summary>
        <form method="POST" action="/admin/personas/${escape(a.id)}">
          <label for="persona-${escape(a.id)}">personaPrompt (톤·타겟·문체·이모지 규칙·금기어 등)</label>
          <textarea id="persona-${escape(a.id)}" name="personaPrompt" rows="10">${escape(a.personaPrompt)}</textarea>
          <div class="actions">
            <button type="submit">저장</button>
            <a href="/admin/personas/preview?accountId=${escape(a.id)}">이 페르소나로 프리뷰</a>
          </div>
        </form>
      </details>`,
      )
      .join('\n');

    return reply.type('text/html').send(
      renderPage(
        '계정 페르소나 관리',
        `
        <p>총 ${accounts.length}개 계정. 각 계정의 personaPrompt가 Copywriter의 유일한 톤·타겟 기준입니다.</p>
        ${rows || '<p>등록된 계정 없음.</p>'}
        <hr>
        <h2>다국어 원본으로 프리뷰</h2>
        <form method="GET" action="/admin/personas/preview">
          <label for="text">원본 텍스트 (한/영/중/일 다 가능)</label>
          <textarea id="text" name="text" rows="4" placeholder="예: 这款面霜真的绝了，用了一周皮肤水嫩到不行"></textarea>
          <label for="lang">감지 언어 힌트 (선택)</label>
          <input type="text" id="lang" name="lang" placeholder="ko / en / zh / ja">
          <label for="product">참고 상품명 (선택)</label>
          <input type="text" id="product" name="product" placeholder="예: PDRN 앰플">
          <div class="actions">
            <button type="submit">5계정 프리뷰 생성</button>
          </div>
        </form>
        <p><a href="/oauth/threads/accounts">← Threads 계정 목록</a></p>
        `,
      ),
    );
  });

  app.post<{ Params: { accountId: string }; Body: any }>(
    '/admin/personas/:accountId',
    async (req, reply) => {
      const body = req.body as Record<string, unknown>;
      const personaPrompt = typeof body.personaPrompt === 'string' ? body.personaPrompt : '';
      if (personaPrompt.length < 10) {
        return reply
          .code(400)
          .type('text/html')
          .send(renderPage('저장 실패', 'personaPrompt는 10자 이상이어야 합니다.'));
      }
      await prisma.account.update({
        where: { id: req.params.accountId },
        data: { personaPrompt },
      });
      logger.info({ accountId: req.params.accountId, len: personaPrompt.length }, 'persona updated');
      return reply.redirect('/admin/personas');
    },
  );

  app.get<{
    Querystring: { accountId?: string; text?: string; lang?: string; product?: string };
  }>('/admin/personas/preview', async (req, reply) => {
    const { accountId, text, lang, product } = req.query;
    const sourceText = text?.trim();

    if (!sourceText) {
      return reply.redirect('/admin/personas');
    }

    let accountsToPreview = await prisma.account.findMany({
      where: accountId ? { id: accountId } : { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, handle: true, personaPrompt: true },
    });

    if (accountsToPreview.length === 0) {
      return reply
        .type('text/html')
        .send(renderPage('프리뷰 실패', '활성 계정이 없습니다.'));
    }

    const results = await Promise.allSettled(
      accountsToPreview.map(async (a) => {
        const body = await generateBody({
          sourceText,
          sourceLanguage: lang?.trim() || null,
          productName: product?.trim() || undefined,
          personaPrompt: a.personaPrompt,
          accountSeed: a.id,
        });
        return { handle: a.handle, body };
      }),
    );

    const cards = results
      .map((r, i) => {
        const acc = accountsToPreview[i];
        if (r.status === 'fulfilled') {
          return `
          <div class="card">
            <h3>${escape(r.value.handle)}</h3>
            <p class="body">${escape(r.value.body)}</p>
          </div>`;
        }
        return `
          <div class="card err">
            <h3>${escape(acc?.handle ?? '?')} — 실패</h3>
            <p>${escape(r.reason?.message ?? String(r.reason))}</p>
          </div>`;
      })
      .join('\n');

    return reply.type('text/html').send(
      renderPage(
        '페르소나 프리뷰',
        `
        <details>
          <summary>원본</summary>
          <pre>${escape(sourceText)}</pre>
          <p class="muted">감지 언어 힌트: ${escape(lang || '(없음)')} · 참고 상품: ${escape(product || '(없음)')}</p>
        </details>
        <div class="grid">${cards}</div>
        <p><a href="/admin/personas">← 페르소나 관리로</a></p>
        `,
      ),
    );
  });
}

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>${escape(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:960px;margin:32px auto;padding:0 20px;color:#222;line-height:1.5}
h1{margin-bottom:16px}
h2{margin-top:32px;border-top:1px solid #eee;padding-top:20px}
details{border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin:12px 0;background:#fafafa}
summary{cursor:pointer;font-size:1.05em;padding:4px 0}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.8em;margin-left:8px}
.badge.ok{background:#c8e6c9;color:#1b5e20}
.badge.off{background:#eee;color:#666}
.muted{color:#888;font-size:0.9em;margin-left:8px}
textarea,input[type=text]{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:0.9em;box-sizing:border-box;margin-bottom:8px}
label{display:block;font-weight:600;margin-top:8px;margin-bottom:4px}
button{padding:6px 14px;background:#0969da;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.95em}
button:hover{background:#0860c7}
.actions{display:flex;gap:12px;align-items:center;margin-top:10px}
.actions a{color:#0969da;text-decoration:none;font-size:0.9em}
.actions a:hover{text-decoration:underline}
pre{background:#f4f4f4;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:0.9em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:20px}
.card{border:1px solid #ddd;border-radius:8px;padding:16px;background:#fff}
.card.err{border-color:#e57373;background:#ffebee}
.card h3{margin:0 0 12px;font-size:1em;color:#0969da}
.card .body{margin:0;font-size:1em;white-space:pre-wrap;line-height:1.6}
</style>
</head><body>
<h1>${escape(title)}</h1>
${bodyHtml}
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
