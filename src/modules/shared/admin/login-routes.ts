import type { FastifyInstance } from 'fastify';
import { verifyCredentials } from './admin-user-service.js';
import { issueSession, SESSION_COOKIE_NAME } from './session.js';
import { logger } from '../../../config/logger.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * 로그인 · 로그아웃 라우트 (인증 없이 접근 가능).
 * - GET  /admin/login  → 로그인 폼
 * - POST /admin/login  → 검증 · 세션 쿠키 발급 · 리다이렉트
 * - POST /admin/logout → 세션 쿠키 제거 · /admin/login 리다이렉트
 */

export const LOGIN_PATHS = new Set(['/admin/login', '/admin/logout']);

export async function registerLoginRoutes(app: AnyFastify): Promise<void> {
  app.get<{ Querystring: { redirect?: string; error?: string } }>(
    '/admin/login',
    async (req, reply) => {
      const redirect = sanitizeRedirect(req.query.redirect);
      const errorMsg =
        req.query.error === 'invalid'
          ? '아이디 또는 비밀번호가 올바르지 않습니다.'
          : req.query.error === 'required'
            ? '로그인이 필요합니다.'
            : null;

      return reply.type('text/html').send(renderLogin({ redirect, errorMsg }));
    },
  );

  app.post<{ Body: { username?: string; password?: string; redirect?: string } }>(
    '/admin/login',
    async (req, reply) => {
      const b = req.body ?? {};
      const username = (b.username ?? '').trim();
      const password = b.password ?? '';
      const redirect = sanitizeRedirect(b.redirect);

      if (!username || !password) {
        return reply.redirect(`/admin/login?error=invalid&redirect=${encodeURIComponent(redirect)}`);
      }

      const user = await verifyCredentials(username, password);
      if (!user) {
        logger.warn({ username }, 'admin login failed');
        return reply.redirect(`/admin/login?error=invalid&redirect=${encodeURIComponent(redirect)}`);
      }

      const { value, maxAge } = issueSession({ userId: user.id, username: user.username });
      reply.setCookie(SESSION_COOKIE_NAME, value, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false, // 로컬 HTTP 사용. 프로덕션 HTTPS 이전 시 true로.
        maxAge,
      });
      logger.info({ username: user.username }, 'admin login success');
      return reply.redirect(redirect);
    },
  );

  app.post('/admin/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.redirect('/admin/login');
  });
}

function sanitizeRedirect(input: string | undefined): string {
  if (!input) return '/admin';
  // 오픈 리다이렉트 방지: 내부 경로만 허용
  if (input.startsWith('/') && !input.startsWith('//')) return input;
  return '/admin';
}

function renderLogin(input: { redirect: string; errorMsg: string | null }): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>로그인 · Pinpoint Threads</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  margin: 0; padding: 0;
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.card {
  background: #fff;
  padding: 36px 32px;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.15);
  width: 100%;
  max-width: 360px;
}
h1 {
  margin: 0 0 4px;
  font-size: 1.4em;
  color: #222;
}
.sub {
  color: #888;
  font-size: 0.9em;
  margin-bottom: 24px;
}
label {
  display: block;
  font-weight: 600;
  font-size: 0.85em;
  color: #555;
  margin-top: 14px;
  margin-bottom: 4px;
}
input[type=text], input[type=password] {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 0.95em;
}
input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.2);
}
button {
  width: 100%;
  margin-top: 20px;
  padding: 10px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 1em;
  font-weight: 600;
  cursor: pointer;
}
button:hover { background: #5a6fd8; }
.error {
  margin-top: 12px;
  padding: 10px 12px;
  background: #ffebee;
  color: #c62828;
  border-radius: 6px;
  font-size: 0.85em;
  border-left: 3px solid #c62828;
}
.footer {
  margin-top: 24px;
  text-align: center;
  color: #999;
  font-size: 0.78em;
}
</style>
</head>
<body>
<div class="card">
  <h1>Pinpoint Threads</h1>
  <div class="sub">관리자 로그인</div>

  ${input.errorMsg ? `<div class="error">${escape(input.errorMsg)}</div>` : ''}

  <form method="POST" action="/admin/login" autocomplete="on">
    <label for="username">아이디</label>
    <input type="text" id="username" name="username" required autofocus autocomplete="username">
    <label for="password">비밀번호</label>
    <input type="password" id="password" name="password" required autocomplete="current-password">
    <input type="hidden" name="redirect" value="${escape(input.redirect)}">
    <button type="submit">로그인</button>
  </form>

  <div class="footer">
    비번을 잊었다면 서버에서 <code>pnpm admin:list</code> → <code>.env</code>로 재설정
  </div>
</div>
</body>
</html>`;
}

function escape(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
