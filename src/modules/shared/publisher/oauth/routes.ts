import type { FastifyInstance } from 'fastify';
type AnyFastify = FastifyInstance<any, any, any, any, any>;
import { randomBytes } from 'node:crypto';
import { env } from '../../../../config/env.js';
import { buildAuthorizeUrl } from '../../../../infra/threads-client.js';
import { logger } from '../../../../config/logger.js';
import { connectAccountFromAuthCode, refreshAccountToken } from './token-service.js';
import { prisma } from '../../../../db/prisma.js';
import { Prisma } from '@prisma/client';

const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map<string, { createdAt: number }>();

function issueState(): string {
  purgeExpiredStates();
  const state = randomBytes(24).toString('hex');
  pendingStates.set(state, { createdAt: Date.now() });
  return state;
}

function consumeState(state: string): boolean {
  purgeExpiredStates();
  const entry = pendingStates.get(state);
  if (!entry) return false;
  pendingStates.delete(state);
  return Date.now() - entry.createdAt <= STATE_TTL_MS;
}

function purgeExpiredStates(): void {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}

export async function registerThreadsOAuthRoutes(app: AnyFastify): Promise<void> {
  app.get('/oauth/threads/start', async (_req, reply) => {
    if (!env.META_APP_ID || !env.META_REDIRECT_URI) {
      return reply.code(500).send({ error: 'META_APP_ID / META_REDIRECT_URI not configured' });
    }
    const state = issueState();
    const url = buildAuthorizeUrl({
      appId: env.META_APP_ID,
      redirectUri: env.META_REDIRECT_URI,
      state,
    });
    return reply.redirect(url);
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>('/oauth/threads/callback', async (req, reply) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      logger.warn({ error, error_description }, 'Threads OAuth error');
      return reply
        .code(400)
        .type('text/html')
        .send(renderPage('연결 실패', `Meta 응답 오류: ${error} — ${error_description ?? ''}`));
    }
    if (!code || !state) {
      return reply
        .code(400)
        .type('text/html')
        .send(renderPage('연결 실패', '필수 파라미터(code 또는 state) 누락.'));
    }
    if (!consumeState(state)) {
      return reply
        .code(400)
        .type('text/html')
        .send(renderPage('연결 실패', 'state 검증 실패 (만료되었거나 위조됨). 처음부터 다시 시도해주세요.'));
    }

    try {
      const result = await connectAccountFromAuthCode(code);
      logger.info(result, 'OAuth callback succeeded');
      return reply
        .type('text/html')
        .send(
          renderPage(
            result.isNew ? '계정 연결 완료' : '계정 토큰 갱신 완료',
            `
              <p><strong>${escape(result.handle)}</strong> 계정이 연결되었습니다.</p>
              <ul>
                <li>Account ID: <code>${escape(result.accountId)}</code></li>
                <li>Threads User ID: <code>${escape(result.threadsUserId)}</code></li>
                <li>토큰 만료: <code>${result.expiresAt.toISOString()}</code></li>
              </ul>
              <p><a href="/oauth/threads/start">다른 계정 연결하기</a> · <a href="/oauth/threads/accounts">연결된 계정 목록</a></p>
            `,
          ),
        );
    } catch (err: any) {
      logger.error({ err }, 'OAuth callback processing failed');
      return reply
        .code(500)
        .type('text/html')
        .send(renderPage('연결 실패', `내부 처리 중 오류: ${escape(String(err?.message ?? err))}`));
    }
  });

  app.get('/oauth/threads/accounts', async (_req, reply) => {
    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        handle: true,
        threadsUserId: true,
        tokenExpiresAt: true,
        isActive: true,
        createdAt: true,
      },
    });

    const rows = accounts
      .map((a) => {
        const expiresLabel = a.tokenExpiresAt ? a.tokenExpiresAt.toISOString() : 'n/a';
        const activeLabel = a.isActive ? '✅' : '⛔';
        return `
          <tr>
            <td>${activeLabel}</td>
            <td><strong>${escape(a.handle)}</strong></td>
            <td><code>${escape(a.threadsUserId)}</code></td>
            <td><code>${expiresLabel}</code></td>
            <td>
              <form method="POST" action="/oauth/threads/accounts/${escape(a.id)}/refresh" style="display:inline">
                <button type="submit">refresh</button>
              </form>
              <form method="POST" action="/oauth/threads/accounts/${escape(a.id)}/delete" style="display:inline" onsubmit="return confirm('정말 삭제하시겠습니까? (${escape(a.handle)})');">
                <button type="submit" style="color:#c00">delete</button>
              </form>
            </td>
          </tr>`;
      })
      .join('');

    return reply.type('text/html').send(
      renderPage(
        'Threads 연결 계정',
        `
        <p>총 ${accounts.length}개 계정 연결됨.</p>
        <table border="1" cellpadding="6" cellspacing="0">
          <thead><tr><th>활성</th><th>handle</th><th>Threads UID</th><th>토큰 만료</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">(없음)</td></tr>'}</tbody>
        </table>
        <p><a href="/oauth/threads/start">계정 추가 연결</a></p>
        `,
      ),
    );
  });

  app.post<{ Params: { accountId: string } }>(
    '/oauth/threads/accounts/:accountId/delete',
    async (req, reply) => {
      const account = await prisma.account.findUnique({ where: { id: req.params.accountId } });
      if (!account) {
        return reply.code(404).type('text/html').send(renderPage('삭제 실패', '계정을 찾을 수 없습니다.'));
      }
      try {
        await prisma.account.delete({ where: { id: req.params.accountId } });
        logger.info({ accountId: account.id, handle: account.handle }, 'Account deleted');
        return reply.type('text/html').send(
          renderPage(
            '삭제 완료',
            `<p><strong>${escape(account.handle)}</strong> 계정이 삭제되었습니다.</p>
             <p><a href="/oauth/threads/accounts">목록으로</a></p>`,
          ),
        );
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          await prisma.account.update({
            where: { id: req.params.accountId },
            data: { isActive: false },
          });
          logger.warn({ accountId: account.id, handle: account.handle }, 'Delete blocked by FK → deactivated instead');
          return reply.type('text/html').send(
            renderPage(
              '삭제 대신 비활성 처리',
              `<p><strong>${escape(account.handle)}</strong> 계정에 관련 데이터(게시글 등)가 있어 삭제할 수 없습니다.</p>
               <p>대신 <strong>비활성(inactive)</strong>으로 표시했습니다. Publisher는 이 계정에 발행하지 않습니다.</p>
               <p><a href="/oauth/threads/accounts">목록으로</a></p>`,
            ),
          );
        }
        return reply.code(500).type('text/html').send(
          renderPage('삭제 실패', escape(String((err as Error)?.message ?? err))),
        );
      }
    },
  );

  app.post<{ Params: { accountId: string } }>(
    '/oauth/threads/accounts/:accountId/refresh',
    async (req, reply) => {
      try {
        const result = await refreshAccountToken(req.params.accountId);
        return reply
          .type('text/html')
          .send(
            renderPage(
              '토큰 갱신 완료',
              `<p><strong>${escape(result.handle)}</strong> 토큰이 갱신되었습니다.</p>
               <p>새 만료: <code>${result.expiresAt.toISOString()}</code></p>
               <p><a href="/oauth/threads/accounts">목록으로</a></p>`,
            ),
          );
      } catch (err: any) {
        return reply
          .code(500)
          .type('text/html')
          .send(renderPage('갱신 실패', escape(String(err?.message ?? err))));
      }
    },
  );
}

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#222}code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:0.9em}table{border-collapse:collapse;width:100%}th,td{text-align:left}button{padding:4px 10px}</style>
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
