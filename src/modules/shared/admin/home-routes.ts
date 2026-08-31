import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../db/prisma.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * /admin 대시보드 홈. 모든 관리 페이지의 진입점.
 */

export async function registerAdminHomeRoutes(app: AnyFastify): Promise<void> {
  app.get('/admin', async (_req, reply) => {
    const [accounts, activeSignals, decayedSignals, inbound, recentInbound] = await Promise.all([
      prisma.account.count({ where: { isActive: true } }),
      prisma.trendSignal.count({ where: { decayedAt: null } }),
      prisma.trendSignal.count({ where: { decayedAt: { not: null } } }),
      prisma.inboundLink.count(),
      prisma.inboundLink.count({
        where: { receivedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    return reply.type('text/html').send(
      renderHome({ accounts, activeSignals, decayedSignals, inbound, recentInbound }),
    );
  });
}

function renderHome(stats: {
  accounts: number;
  activeSignals: number;
  decayedSignals: number;
  inbound: number;
  recentInbound: number;
}): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>Pinpoint Threads · Admin</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#222;line-height:1.6}
h1{margin-bottom:8px;font-size:1.6em}
.sub{color:#888;margin-bottom:32px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.card{padding:20px;border:1px solid #e0e0e0;border-radius:10px;background:#fafafa;text-decoration:none;color:#222;transition:all 0.15s}
.card:hover{background:#fff;border-color:#0969da;box-shadow:0 2px 8px rgba(9,105,218,0.1)}
.card h2{font-size:1.05em;margin:0 0 8px}
.card .stat{font-size:2em;font-weight:600;color:#0969da;line-height:1}
.card .stat small{font-size:0.5em;color:#888;font-weight:400;margin-left:8px}
.card p{margin:8px 0 0;color:#666;font-size:0.88em}
.section{margin-top:32px}
.section h2{font-size:1.1em;color:#555;border-top:1px solid #eee;padding-top:20px}
.links{display:flex;flex-wrap:wrap;gap:12px}
.links a{padding:8px 14px;background:#f0f0f0;color:#333;border-radius:6px;text-decoration:none;font-size:0.9em}
.links a:hover{background:#e0e0e0}
</style>
</head><body>
<h1>Pinpoint Threads · Admin</h1>
<p class="sub">시스템 상태 · 데이터 · 관리</p>

<div class="grid">
  <a class="card" href="/admin/inbound">
    <h2>유입 URL</h2>
    <div class="stat">${stats.inbound}<small>+${stats.recentInbound} / 24h</small></div>
    <p>Lane 1 · Lane 2 통합 InboundLink</p>
  </a>
  <a class="card" href="/admin/trends">
    <h2>트렌드 시그널</h2>
    <div class="stat">${stats.activeSignals}<small>${stats.decayedSignals} decayed</small></div>
    <p>자율 트렌드 감지 대시보드</p>
  </a>
  <a class="card" href="/admin/personas">
    <h2>계정 페르소나</h2>
    <div class="stat">${stats.accounts}<small>활성</small></div>
    <p>5계정 페르소나 편집 · 다국어 프리뷰</p>
  </a>
  <a class="card" href="/oauth/threads/accounts">
    <h2>Threads OAuth</h2>
    <div class="stat">${stats.accounts}<small>연결</small></div>
    <p>토큰 · refresh · 계정 관리</p>
  </a>
</div>

<div class="section">
  <h2>빠른 링크</h2>
  <div class="links">
    <a href="/oauth/threads/start">계정 추가 연결</a>
    <a href="/admin/trends">트렌드 poll 실행</a>
    <a href="/admin/personas">페르소나 프리뷰</a>
    <a href="/admin/inbound?status=FAILED">실패한 인제스트</a>
    <a href="/admin/inbound?status=FETCHED">인제스트 성공한 것</a>
    <a href="/admin/password">계정·비밀번호 관리</a>
    <a href="/healthz">healthz</a>
  </div>
</div>
</body></html>`;
}
