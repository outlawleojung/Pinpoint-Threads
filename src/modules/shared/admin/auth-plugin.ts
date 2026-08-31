import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import basicAuth from '@fastify/basic-auth';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * Admin 라우트 보호 (Basic Auth).
 *
 * 보호 경로:
 *   - /admin/*
 *   - /oauth/threads/accounts, /oauth/threads/accounts/*
 *   (/oauth/threads/start, /callback은 Meta 리다이렉트라 인증 걸면 안 됨)
 *
 * ADMIN_USERNAME · ADMIN_PASSWORD 미설정 시:
 *   - 개발 편의로 인증 skip
 *   - 로그에 경고 출력
 *   - 프로덕션에서는 반드시 설정
 */

const PROTECTED_PREFIXES = [
  '/admin',
  '/oauth/threads/accounts',
];

// 인증에서 제외할 정확한 경로 (Meta OAuth 콜백 등)
const EXEMPT_PATHS = new Set([
  '/oauth/threads/start',
  '/oauth/threads/callback',
]);

export async function registerAdminAuth(app: AnyFastify): Promise<void> {
  const username = env.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD;

  if (!username || !password) {
    logger.warn(
      '⚠️ ADMIN_USERNAME/ADMIN_PASSWORD 미설정 — /admin/* 및 /oauth/threads/accounts 인증 없음. 프로덕션 이전 전 반드시 설정.',
    );
    return;
  }

  await app.register(basicAuth, {
    validate: async (user, pass) => {
      if (user !== username || pass !== password) {
        throw new Error('invalid credentials');
      }
    },
    authenticate: { realm: 'Pinpoint Threads Admin' },
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0] ?? '';
    if (EXEMPT_PATHS.has(url)) return;
    if (!PROTECTED_PREFIXES.some((p) => url === p || url.startsWith(p + '/'))) return;
    await (app as any).basicAuth(req, reply);
  });

  logger.info({ user: username, protected: PROTECTED_PREFIXES }, 'admin basic auth enabled');
}
