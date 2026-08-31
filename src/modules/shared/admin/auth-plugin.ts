import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import basicAuth from '@fastify/basic-auth';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import {
  verifyCredentials,
  upsertAdminUserFromEnv,
  hasAnyAdmin,
} from './admin-user-service.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * Admin 라우트 보호 (DB backed Basic Auth).
 *
 * 원칙:
 *   - 관리자 크레덴셜은 AdminUser 테이블에만 저장 (bcrypt 해시)
 *   - .env의 ADMIN_USERNAME/PASSWORD는 부트스트랩용 — 첫 실행 시 DB upsert
 *   - AdminUser 0개일 때 웹은 완전 차단 (503) — CLI 또는 env 부트스트랩만
 *   - **인증 skip 절대 없음** (auth-less 진입점 폐쇄)
 *
 * 보호 경로:
 *   - /admin/*
 *   - /oauth/threads/accounts, /oauth/threads/accounts/*
 *
 * 예외 (Meta 리다이렉트 · 헬스체크):
 *   - /oauth/threads/start, /oauth/threads/callback
 *   - /healthz
 */

const PROTECTED_PREFIXES = ['/admin', '/oauth/threads/accounts'];
const EXEMPT_PATHS = new Set([
  '/oauth/threads/start',
  '/oauth/threads/callback',
]);

export async function registerAdminAuth(app: AnyFastify): Promise<void> {
  // 부트스트랩 (env → DB upsert)
  if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    try {
      await upsertAdminUserFromEnv(env.ADMIN_USERNAME, env.ADMIN_PASSWORD);
    } catch (err) {
      logger.error({ err }, 'admin bootstrap failed');
    }
  }

  // Basic Auth 플러그인은 항상 등록 (validate가 DB 조회)
  await app.register(basicAuth, {
    validate: async (username, password) => {
      const user = await verifyCredentials(username, password);
      if (!user) throw new Error('invalid credentials');
    },
    authenticate: { realm: 'Pinpoint Threads Admin' },
  });

  const basicAuthHook = (app as any).basicAuth as (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>;

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0] ?? '';
    if (EXEMPT_PATHS.has(url)) return;
    if (!PROTECTED_PREFIXES.some((p) => url === p || url.startsWith(p + '/'))) return;

    // AdminUser 0개 → 웹 접근 완전 차단
    const adminExists = await hasAnyAdmin();
    if (!adminExists) {
      logger.warn({ url }, 'admin access blocked — no AdminUser bootstrapped yet');
      reply.code(503).type('text/html').send(uninitializedPage());
      return reply;
    }

    // Basic Auth 강제. 실패 시 basicAuthHook이 throw → Fastify 에러 핸들러가 401 처리.
    try {
      await basicAuthHook(req, reply);
    } catch (err: any) {
      // basicAuth 실패 시 자체 401 응답을 보낼 수도, throw만 할 수도 있음.
      // reply.sent 검사 후 미전송이면 우리가 401 보냄.
      if (!reply.sent) {
        logger.debug({ url, err: err?.message }, 'basic auth failed');
        reply.header('WWW-Authenticate', 'Basic realm="Pinpoint Threads Admin"');
        reply.code(401).send({ error: 'Unauthorized' });
      }
      return reply;
    }
  });

  logger.info({ protected: PROTECTED_PREFIXES }, 'admin basic auth enabled (DB backed, no skip)');
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
웹에서 계정 생성은 <strong>불가</strong>합니다. 다음 두 방법으로만 부트스트랩 가능.
</div>

<h2>방법 1: 환경변수로 부트스트랩</h2>
<pre># .env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=&lt;12자 이상 강한 랜덤&gt;</pre>
<p>서버 재시작 → 자동으로 <code>AdminUser</code> upsert. 이후 웹에서 로그인 · 비번 변경 후 <code>.env</code>에서 비번 제거.</p>

<h2>방법 2: CLI 스크립트</h2>
<pre>pnpm admin:create</pre>
<p>인터랙티브 프롬프트로 username · 비밀번호 입력. env 없이 안전.</p>

<p style="margin-top:32px;color:#888;font-size:0.85em">이 페이지는 인증 없이 접근됩니다. 초기화 완료 후에는 이 페이지가 뜨지 않습니다.</p>
</body></html>`;
}
