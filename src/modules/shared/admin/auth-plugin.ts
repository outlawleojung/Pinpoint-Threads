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
 * 크레덴셜은 AdminUser 테이블에 bcrypt 해싱 저장.
 * .env의 ADMIN_USERNAME/PASSWORD는 부트스트랩용 (첫 실행 시 DB에 upsert).
 * 이후 웹 UI(/admin/password)에서 변경 · env에서 제거 권장.
 *
 * 보호 경로:
 *   - /admin/*
 *   - /oauth/threads/accounts, /oauth/threads/accounts/*
 *
 * 예외:
 *   - /oauth/threads/start, /oauth/threads/callback (Meta 리다이렉트)
 *   - /healthz
 */

const PROTECTED_PREFIXES = ['/admin', '/oauth/threads/accounts'];

const EXEMPT_PATHS = new Set([
  '/oauth/threads/start',
  '/oauth/threads/callback',
]);

export async function registerAdminAuth(app: AnyFastify): Promise<void> {
  // 부트스트랩: env에 초기 크레덴셜 있으면 DB에 upsert
  if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    try {
      await upsertAdminUserFromEnv(env.ADMIN_USERNAME, env.ADMIN_PASSWORD);
    } catch (err) {
      logger.error({ err }, 'admin bootstrap failed');
    }
  }

  const adminExists = await hasAnyAdmin();
  if (!adminExists) {
    logger.warn(
      '⚠️ DB에 AdminUser 없음 + .env에도 크레덴셜 없음 → /admin/* 인증 skip. 프로덕션 이전 전 반드시 설정.',
    );
    return;
  }

  await app.register(basicAuth, {
    validate: async (username, password) => {
      const user = await verifyCredentials(username, password);
      if (!user) throw new Error('invalid credentials');
    },
    authenticate: { realm: 'Pinpoint Threads Admin' },
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0] ?? '';
    if (EXEMPT_PATHS.has(url)) return;
    if (!PROTECTED_PREFIXES.some((p) => url === p || url.startsWith(p + '/'))) return;
    await (app as any).basicAuth(req, reply);
  });

  logger.info({ protected: PROTECTED_PREFIXES }, 'admin basic auth enabled (DB backed)');
}
