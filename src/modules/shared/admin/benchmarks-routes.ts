import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { tagBenchmarkPost, tagUntaggedBenchmarks } from '../source-collector/viralfactors-tagger.js';
import { embedUntaggedBatch, searchSimilar } from '../source-collector/embedder.js';
import { isVoyageConfigured } from '../../../infra/voyage-client.js';
import { logger } from '../../../config/logger.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * 벤치마크 콘텐츠 관리 UI.
 * - 수집된 BenchmarkPost 목록 (필터·정렬)
 * - 상세: 원문 + 미디어 + viralFactors 태그
 * - 태깅 트리거 (단건 + 배치)
 * - Seed source 관리 (간단)
 */

export async function registerBenchmarksRoutes(app: AnyFastify): Promise<void> {
  app.get<{
    Querystring: { source?: string; taggedOnly?: string; sort?: string; category?: string };
  }>('/admin/benchmarks', async (req, reply) => {
    const { source, taggedOnly, sort, category } = req.query;

    const where: any = {};
    if (source) where.sourceHandle = source;
    if (taggedOnly === '1') where.taggedAt = { not: null };
    if (category) where.viralFactors = { path: ['topic_category'], equals: category };

    const orderBy =
      sort === 'recent'
        ? { collectedAt: 'desc' as const }
        : sort === 'tagged'
          ? { taggedAt: 'desc' as const }
          : { likesCount: 'desc' as const };

    const [rows, totalCount, taggedCount, untaggedCount] = await Promise.all([
      prisma.benchmarkPost.findMany({
        where,
        orderBy,
        take: 50,
      }),
      prisma.benchmarkPost.count(),
      prisma.benchmarkPost.count({ where: { taggedAt: { not: null } } }),
      prisma.benchmarkPost.count({ where: { taggedAt: null } }),
    ]);

    const seedSources = await prisma.seedSource.findMany({
      orderBy: { addedAt: 'asc' },
    });

    const trList = rows
      .map((r) => {
        const factors = r.viralFactors as { hook_type?: string; topic_category?: string } | null;
        const tags = factors
          ? `<span class="tag hook">${escape(factors.hook_type ?? '')}</span> <span class="tag topic">${escape(factors.topic_category ?? '')}</span>`
          : '<span class="muted">(미태깅)</span>';
        return `
        <tr>
          <td><strong>${escape(r.sourceHandle)}</strong></td>
          <td class="num">${r.likesCount.toLocaleString()}</td>
          <td class="num">${r.repliesCount.toLocaleString()}</td>
          <td class="text">${escape((r.text ?? '').slice(0, 100).replace(/\s+/g, ' '))}</td>
          <td>${tags}</td>
          <td>${r.collectedAt.toISOString().slice(0, 10)}</td>
          <td><a href="/admin/benchmarks/${escape(r.id)}">상세</a></td>
        </tr>`;
      })
      .join('');

    const seedList = seedSources
      .map(
        (s) =>
          `<tr>
            <td>${s.isActive ? '✅' : '⛔'}</td>
            <td><strong>${escape(s.handle)}</strong></td>
            <td class="muted">${escape(s.notes ?? '')}</td>
            <td>${s.lastPolledAt ? s.lastPolledAt.toISOString().slice(0, 10) : '-'}</td>
          </tr>`,
      )
      .join('');

    return reply.type('text/html').send(
      renderPage(
        '벤치마크 콘텐츠',
        `
        <div class="stats">
          <div>총 <strong>${totalCount}</strong></div>
          <div>태깅됨 <strong>${taggedCount}</strong></div>
          <div>미태깅 <strong>${untaggedCount}</strong></div>
          <div>시드 <strong>${seedSources.length}</strong></div>
        </div>

        <div class="actions">
          <form method="POST" action="/admin/benchmarks/tag-batch" style="display:inline">
            <button type="submit" ${untaggedCount === 0 ? 'disabled' : ''}>🏷 미태깅 상위 20개 자동 태깅 (Claude)</button>
          </form>
          <form method="POST" action="/admin/benchmarks/embed-batch" style="display:inline">
            <button type="submit" ${isVoyageConfigured() ? '' : 'disabled title="VOYAGE_API_KEY 미설정"'}>🧬 미임베딩 상위 16개 임베딩 (Voyage)</button>
          </form>
          <a href="/admin/benchmarks?sort=recent" class="link-btn">최근 수집순</a>
          <a href="/admin/benchmarks?sort=likes" class="link-btn">좋아요순</a>
          <a href="/admin/benchmarks?taggedOnly=1" class="link-btn">태깅된 것만</a>
        </div>

        <h2>수집된 벤치마크 (${rows.length}건 표시, 총 ${totalCount})</h2>
        <table>
          <thead><tr>
            <th>Source</th><th>👍</th><th>💬</th><th>본문</th><th>태그</th><th>수집일</th><th></th>
          </tr></thead>
          <tbody>${trList || '<tr><td colspan="7" class="muted">아직 벤치마크 없음 · Apify 액터 poll 필요</td></tr>'}</tbody>
        </table>

        <h2>Seed Sources (${seedSources.length}개)</h2>
        <table>
          <thead><tr><th>활성</th><th>Handle</th><th>Notes</th><th>Last Polled</th></tr></thead>
          <tbody>${seedList || '<tr><td colspan="4" class="muted">등록된 시드 없음</td></tr>'}</tbody>
        </table>
        `,
      ),
    );
  });

  app.get<{ Params: { id: string } }>('/admin/benchmarks/:id', async (req, reply) => {
    const post = await prisma.benchmarkPost.findUnique({ where: { id: req.params.id } });
    if (!post) return reply.code(404).type('text/html').send(renderPage('없음', 'BenchmarkPost 없음'));

    const factors = post.viralFactors as Record<string, unknown> | null;
    const factorsHtml = factors
      ? `<dl class="factors">${Object.entries(factors)
          .map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(String(v))}</dd>`)
          .join('')}</dl>`
      : '<p class="muted">아직 태깅 안 됨</p>';

    const mediaList = post.mediaUrls
      .map((u) => `<div class="media"><img src="${escape(u)}" alt="" loading="lazy"></div>`)
      .join('');

    return reply.type('text/html').send(
      renderPage(
        `${post.sourceHandle} · ${post.likesCount.toLocaleString()} likes`,
        `
        <dl>
          <dt>Source Handle</dt><dd>${escape(post.sourceHandle)}</dd>
          <dt>Permalink</dt><dd><a href="${escape(post.permalink)}" target="_blank">${escape(post.permalink)}</a></dd>
          <dt>Platform · External ID</dt><dd><span class="tag topic">${escape(post.platform)}</span> <code>${escape(post.externalPostId)}</code></dd>
          ${post.inboundLinkId ? `<dt>원본 InboundLink</dt><dd><a href="/admin/inbound/${escape(post.inboundLinkId)}">${escape(post.inboundLinkId)}</a></dd>` : ''}
          <dt>Engagement</dt><dd>👍 ${post.likesCount.toLocaleString()} · 💬 ${post.repliesCount.toLocaleString()} · 🔁 ${post.repostsCount.toLocaleString()} · ↪ ${post.quotesCount.toLocaleString()}</dd>
          <dt>Published</dt><dd>${post.publishedAt?.toISOString() ?? '-'}</dd>
          <dt>Collected</dt><dd>${post.collectedAt.toISOString()}</dd>
          <dt>Tagged</dt><dd>${post.taggedAt?.toISOString() ?? '(미태깅)'}</dd>
        </dl>

        <h2>본문</h2>
        <pre>${escape(post.text ?? '')}</pre>

        ${mediaList ? `<h2>미디어 (${post.mediaUrls.length})</h2><div class="media-grid">${mediaList}</div>` : ''}

        <h2>viralFactors</h2>
        ${factorsHtml}

        <div class="actions">
          <form method="POST" action="/admin/benchmarks/${escape(post.id)}/tag" style="display:inline">
            <button type="submit">${post.taggedAt ? '🔄 재태깅' : '🏷 태깅 실행'}</button>
          </form>
          <a href="/admin/benchmarks">← 목록</a>
        </div>
      `,
      ),
    );
  });

  app.post<{ Params: { id: string } }>('/admin/benchmarks/:id/tag', async (req, reply) => {
    try {
      const factors = await tagBenchmarkPost(req.params.id);
      return reply
        .type('text/html')
        .send(
          renderPage(
            '태깅 완료',
            `<pre>${escape(JSON.stringify(factors, null, 2))}</pre>
             <p><a href="/admin/benchmarks/${escape(req.params.id)}">← 상세</a> · <a href="/admin/benchmarks">목록</a></p>`,
          ),
        );
    } catch (err) {
      logger.error({ err, benchmarkPostId: req.params.id }, 'manual tag failed');
      return reply
        .code(500)
        .type('text/html')
        .send(renderPage('태깅 실패', escape((err as Error).message)));
    }
  });

  app.post('/admin/benchmarks/embed-batch', async (_req, reply) => {
    const result = await embedUntaggedBatch(16);
    return reply
      .type('text/html')
      .send(
        renderPage(
          '배치 임베딩 결과',
          `<p>성공: <strong>${result.embedded}</strong> · 실패: ${result.failed} · 소모 토큰: ${result.tokens}</p>
           <p><a href="/admin/benchmarks">← 벤치마크 목록</a></p>`,
        ),
      );
  });

  app.get<{ Querystring: { q?: string; topK?: string; category?: string } }>(
    '/admin/benchmarks/search',
    async (req, reply) => {
      const q = req.query.q?.trim();
      const topK = Math.min(Number(req.query.topK) || 5, 20);
      const category = req.query.category?.trim();

      if (!q) {
        return reply.type('text/html').send(
          renderPage(
            'RAG 유사 검색',
            `
            <form method="GET" action="/admin/benchmarks/search">
              <label>쿼리 텍스트 (한/영/중/일 · 문장으로 입력)</label>
              <textarea name="q" rows="4" style="width:100%;padding:8px" required></textarea>
              <label>Top K</label>
              <input type="number" name="topK" value="5" min="1" max="20" style="padding:6px">
              <label>카테고리 필터 (viralFactors.topic_category, 선택)</label>
              <input type="text" name="category" placeholder="예: beauty_skincare" style="padding:6px">
              <div class="actions" style="margin-top:12px">
                <button type="submit" ${isVoyageConfigured() ? '' : 'disabled'}>검색</button>
              </div>
            </form>
            `,
          ),
        );
      }

      try {
        const results = await searchSimilar({
          queryText: q,
          topK,
          categoryFilter: category || undefined,
        });
        const cards = results
          .map(
            (r) => `
          <div class="hit">
            <div class="hit-meta">
              <strong>${escape(r.sourceHandle)}</strong> · 👍 ${r.likesCount} · dist ${r.distance.toFixed(4)}
            </div>
            <pre>${escape(r.text.slice(0, 400))}</pre>
            <a href="/admin/benchmarks/${escape(r.id)}">상세</a>
          </div>`,
          )
          .join('');
        return reply.type('text/html').send(
          renderPage(
            `RAG 유사 검색 · ${results.length}건`,
            `
            <details><summary>쿼리</summary><pre>${escape(q)}</pre></details>
            ${cards || '<p class="muted">유사한 벤치마크 없음 (임베딩된 데이터가 부족하거나 카테고리 필터에 매칭 없음)</p>'}
            <p><a href="/admin/benchmarks/search">← 새 검색</a></p>
            `,
          ),
        );
      } catch (err) {
        logger.error({ err, q }, 'RAG search failed');
        return reply
          .code(500)
          .type('text/html')
          .send(renderPage('검색 실패', escape((err as Error).message)));
      }
    },
  );

  app.post('/admin/benchmarks/tag-batch', async (_req, reply) => {
    const result = await tagUntaggedBenchmarks(20);
    return reply
      .type('text/html')
      .send(
        renderPage(
          '배치 태깅 결과',
          `<p>태깅 성공: <strong>${result.tagged}</strong> · 실패: ${result.failed}</p>
           <p><a href="/admin/benchmarks">← 벤치마크 목록</a></p>`,
        ),
      );
  });
}

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>${escape(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:1200px;margin:32px auto;padding:0 20px;color:#222;line-height:1.5}
h1{margin-bottom:16px}
h2{margin-top:28px;font-size:1.1em;color:#555;border-top:1px solid #eee;padding-top:16px}
.stats{display:flex;gap:24px;padding:12px 16px;background:#f4f4f4;border-radius:6px;margin:12px 0;font-size:0.95em;color:#666}
.stats strong{color:#0969da;font-size:1.15em;margin-left:6px}
.actions{margin:16px 0;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
button{padding:8px 14px;background:#0969da;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.9em}
button:hover:not(:disabled){background:#0860c7}
button:disabled{background:#999;cursor:not-allowed}
.link-btn{padding:6px 12px;background:#f0f0f0;color:#333;border-radius:4px;text-decoration:none;font-size:0.85em}
.link-btn:hover{background:#e0e0e0}
table{width:100%;border-collapse:collapse;font-size:0.85em}
th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{background:#fafafa;font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}
.text{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#555}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.72em;margin-right:4px}
.tag.hook{background:#fce4ec;color:#880e4f}
.tag.topic{background:#e3f2fd;color:#0d47a1}
.hit{border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin:12px 0;background:#fafafa}
.hit-meta{color:#666;font-size:0.85em;margin-bottom:8px}
.hit pre{background:#fff;margin:8px 0}
label{display:block;font-weight:600;margin-top:12px;margin-bottom:4px;font-size:0.9em}
.muted{color:#999}
pre{background:#f4f4f4;padding:14px;border-radius:6px;white-space:pre-wrap;font-size:0.9em;line-height:1.6}
dl{display:grid;grid-template-columns:180px 1fr;gap:6px 12px;margin:16px 0}
dl.factors{grid-template-columns:180px 1fr;background:#fafafa;padding:14px;border-radius:6px}
dt{font-weight:600;color:#666}
dd{margin:0}
.media-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:10px}
.media img{width:100%;height:auto;border-radius:6px}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-size:0.85em}
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
