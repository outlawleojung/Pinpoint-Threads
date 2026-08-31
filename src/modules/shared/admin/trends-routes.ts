import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import {
  pollAllAdapters,
  getTopActiveSignals,
  decayOldSignals,
  type TrendSourceAdapter,
} from '../trend-signals/index.js';
import { NaverDatalabAdapter } from '../trend-signals/adapters/naver-datalab.js';
import { GoogleTrendsAdapter } from '../trend-signals/adapters/google-trends.js';
import { safeRunTrendSearchIngest } from '../trend-signals/search-orchestrator.js';
import { isApifyConfigured } from '../../../infra/apify-client.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * 트렌드 시그널 관리 UI.
 * - 활성 상위 트렌드 조회
 * - 수동 poll 트리거 (모든 등록 어댑터 실행)
 * - 감쇠 트리거 (오래된 신호 강등)
 */

function buildAdapters(): TrendSourceAdapter[] {
  return [new NaverDatalabAdapter(), new GoogleTrendsAdapter()];
}

export async function registerTrendsRoutes(app: AnyFastify): Promise<void> {
  app.get('/admin/trends', async (_req, reply) => {
    const signals = await getTopActiveSignals({ limit: 50 });
    const totalCount = await prisma.trendSignal.count({ where: { decayedAt: null } });
    const decayedCount = await prisma.trendSignal.count({ where: { decayedAt: { not: null } } });

    const rows = signals
      .map((s) => {
        const vClass = s.velocityPct == null ? 'muted' : s.velocityPct > 0 ? 'up' : 'down';
        const vLabel =
          s.velocityPct == null ? '-' : `${s.velocityPct > 0 ? '+' : ''}${s.velocityPct.toFixed(1)}%`;
        return `
        <tr>
          <td><span class="badge">${escape(s.source)}</span></td>
          <td><strong>${escape(s.keyword)}</strong></td>
          <td>${escape(s.category ?? '-')}</td>
          <td class="num">${s.currentValue.toFixed(1)}</td>
          <td class="num ${vClass}">${vLabel}</td>
          <td class="num">${s.crossPlatformScore}</td>
          <td>${s.lastSeenAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
          <td>${s.observationCount}</td>
        </tr>`;
      })
      .join('');

    return reply.type('text/html').send(
      renderPage(
        '트렌드 시그널 대시보드',
        `
        <div class="stats">
          <div>활성 신호 <strong>${totalCount}</strong></div>
          <div>감쇠 신호 <strong>${decayedCount}</strong></div>
        </div>

        <div class="actions">
          <form method="POST" action="/admin/trends/poll" style="display:inline">
            <button type="submit">🔄 지금 poll 실행</button>
          </form>
          <form method="POST" action="/admin/trends/search" style="display:inline"
            onsubmit="return confirm('상위 5개 트렌드로 모든 플랫폼 검색 · 인제스트 실행. Apify 비용 발생 가능. 계속?');">
            <button type="submit" ${isApifyConfigured() ? '' : 'disabled title="APIFY_API_TOKEN 미설정"'}>🔎 트렌드 검색 · 자동 인제스트</button>
          </form>
          <form method="POST" action="/admin/trends/decay" style="display:inline">
            <button type="submit">⏳ 14일 이상 오래된 신호 감쇠</button>
          </form>
        </div>

        <h2>상위 활성 시그널 (velocity · cross-platform 순)</h2>
        <table>
          <thead><tr>
            <th>Source</th><th>Keyword</th><th>Category</th>
            <th>Value</th><th>Δ</th><th>×</th><th>Last</th><th>N</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="muted">아직 신호 없음 · poll 실행 필요</td></tr>'}</tbody>
        </table>
        `,
      ),
    );
  });

  app.post('/admin/trends/poll', async (_req, reply) => {
    const adapters = buildAdapters();
    logger.info({ adapters: adapters.map((a) => a.source) }, 'manual trend poll started');
    const summary = await pollAllAdapters(adapters);

    const rows = summary
      .map(
        (s) => `
      <tr>
        <td>${escape(s.source)}</td>
        <td class="num">${s.fetched}</td>
        <td class="num">${s.upserted}</td>
        <td>${s.errors.length ? `<span class="err">${s.errors.length}건</span>` : 'OK'}</td>
      </tr>`,
      )
      .join('');

    const errs = summary
      .flatMap((s) => s.errors.map((e) => `[${s.source}] ${e}`))
      .join('\n');

    return reply.type('text/html').send(
      renderPage(
        'Poll 실행 결과',
        `
        <table>
          <thead><tr><th>Source</th><th>Fetched</th><th>Upserted</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${errs ? `<h3>에러 로그</h3><pre>${escape(errs)}</pre>` : ''}
        <p><a href="/admin/trends">← 대시보드로</a></p>
        `,
      ),
    );
  });

  app.post('/admin/trends/search', async (_req, reply) => {
    logger.info('manual trend search + ingest triggered');
    const summary = await safeRunTrendSearchIngest({ topSignals: 5, perPlatformResults: 10, minLikes: 100 });

    if (!summary) {
      return reply
        .type('text/html')
        .send(renderPage('트렌드 검색 skip', 'APIFY_API_TOKEN 미설정 또는 실행 중 오류. 서버 로그 확인.'));
    }

    const rows = summary.perPlatform
      .map(
        (p) => `
      <tr>
        <td>${escape(p.platform)}</td>
        <td class="num">${p.searchedKeywords}</td>
        <td class="num">${p.candidates}</td>
        <td class="num">${p.ingested}</td>
        <td>${p.errors.length ? `<span class="err">${p.errors.length}건</span>` : 'OK'}</td>
      </tr>`,
      )
      .join('');

    const errs = summary.perPlatform.flatMap((p) => p.errors.map((e) => `[${p.platform}] ${e}`)).join('\n');

    return reply.type('text/html').send(
      renderPage(
        '트렌드 검색 · 인제스트 결과',
        `
        <p>처리한 시그널: ${summary.signalsProcessed}개</p>
        <table>
          <thead><tr><th>Platform</th><th>Keywords</th><th>Candidates</th><th>Ingested</th><th>Status</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="muted">설정된 플랫폼 없음</td></tr>'}</tbody>
        </table>
        ${errs ? `<h3>에러</h3><pre>${escape(errs)}</pre>` : ''}
        <p><a href="/admin/trends">← 대시보드</a> · <a href="/admin/inbound?source=AUTONOMOUS_TREND">자율 인제스트 결과</a></p>
        `,
      ),
    );
  });

  app.post('/admin/trends/decay', async (_req, reply) => {
    const count = await decayOldSignals(14);
    return reply.type('text/html').send(
      renderPage(
        '감쇠 완료',
        `<p>${count}개 신호가 감쇠(decayed) 처리되었습니다.</p>
         <p><a href="/admin/trends">← 대시보드로</a></p>`,
      ),
    );
  });
}

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>${escape(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#222;line-height:1.5}
h1{margin-bottom:16px}
h2{margin-top:32px;border-top:1px solid #eee;padding-top:20px;font-size:1.15em}
h3{margin-top:20px;font-size:1em;color:#666}
.stats{display:flex;gap:24px;font-size:1.05em;padding:12px 16px;background:#f4f4f4;border-radius:6px;margin:12px 0}
.stats div{color:#666}.stats strong{color:#222;font-size:1.2em;margin-left:6px}
.actions{margin:16px 0;display:flex;gap:12px}
button{padding:8px 14px;background:#0969da;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.95em}
button:hover{background:#0860c7}
table{width:100%;border-collapse:collapse;font-size:0.9em}
th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left}
th{background:#fafafa;font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}
.up{color:#1a7f37}
.down{color:#c00}
.muted{color:#999}
.err{color:#c00}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;background:#e3f2fd;color:#0d47a1;font-size:0.75em;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
pre{background:#f4f4f4;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:0.85em}
a{color:#0969da}
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
