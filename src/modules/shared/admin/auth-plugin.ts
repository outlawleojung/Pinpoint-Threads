import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import {
  upsertAdminUserFromEnv,
  hasAnyAdmin,
} from './admin-user-service.js';
import { verifySession, SESSION_COOKIE_NAME, type SessionPayload } from './session.js';
import { LOGIN_PATHS } from './login-routes.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * Admin 라우트 보호 (세션 쿠키 기반).
 *
 * 흐름:
 *   1) /admin/login, /admin/logout, /healthz, Meta OAuth 콜백 → 항상 통과
 *   2) 나머지 /admin/*, /oauth/threads/accounts → 세션 쿠키 검증
 *      - 유효 → req.session에 정보 부여 후 진행
 *      - 무효 → GET는 /admin/login?redirect=... 로 리다이렉트, 그 외는 401
 *   3) AdminUser 0개 → 503 (부트스트랩 안내)
 *
 * .env의 ADMIN_USERNAME/PASSWORD는 부트스트랩용 (첫 실행 시 DB upsert).
 * 이후 웹에서 비번 변경 · env는 비워도 됨.
 */

const PROTECTED_PREFIXES = ['/admin', '/oauth/threads/accounts'];
const EXEMPT_EXACT = new Set([
  '/oauth/threads/start',
  '/oauth/threads/callback',
  '/healthz',
]);

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionPayload;
  }
}

export async function registerAdminAuth(app: AnyFastify): Promise<void> {
  // 부트스트랩 (env → DB upsert)
  if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    try {
      await upsertAdminUserFromEnv(env.ADMIN_USERNAME, env.ADMIN_PASSWORD);
    } catch (err) {
      logger.error({ err }, 'admin bootstrap failed');
    }
  }

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0] ?? '';

    if (EXEMPT_EXACT.has(url)) return;
    if (LOGIN_PATHS.has(url)) return;
    if (!PROTECTED_PREFIXES.some((p) => url === p || url.startsWith(p + '/'))) return;

    // AdminUser 0개 → 웹 접근 완전 차단
    const adminExists = await hasAnyAdmin();
    if (!adminExists) {
      logger.warn({ url }, 'admin access blocked — no AdminUser bootstrapped');
      reply.code(503).type('text/html').send(uninitializedPage());
      return reply;
    }

    // 세션 쿠키 검증
    const cookieValue = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
    const session = verifySession(cookieValue);

    if (!session) {
      const wantsHtml = (req.headers.accept ?? '').includes('text/html');
      if (req.method === 'GET' && wantsHtml) {
        const redirect = encodeURIComponent(req.url);
        reply.redirect(`/admin/login?error=required&redirect=${redirect}`);
        return reply;
      }
      reply.code(401).send({ error: 'Unauthorized' });
      return reply;
    }

    req.session = session;
  });

  logger.info({ protected: PROTECTED_PREFIXES }, 'admin session auth enabled');
}

function uninitializedPage(): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>시스템 초기화 필요</title>
<style>
body{font-family:-apple-system,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.7}
h1{color:#c62828}
code{background:#f4f4f4;padding:3px 8px;border-radius:4px;font-size:0.9em}
pre{background:#f4f4f4;padding:14px;border-radius:6px;font-size:0.85em;overflow-x:auto}
.warn{background:#ffebee;padding:14px;border-left:4px solid #c62828;border-radius:4px}
</style>
</head><body>
<h1>🔒 시스템 초기화 필요</h1>
<div class="warn">
AdminUser가 하나도 없어서 Admin UI 접근이 차단되었습니다.
</div>
<h2>방법 1: 환경변수 부트스트랩</h2>
<pre># .env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=&lt;12자 이상&gt;</pre>
<p>서버 재시작 → 자동으로 AdminUser upsert.</p>
<h2>방법 2: CLI</h2>
<pre>pnpm admin:create</pre>
</body></html>`;
}
