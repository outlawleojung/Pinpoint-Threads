import type { FastifyInstance } from 'fastify';
import { logger } from '../../../config/logger.js';
import { prisma } from '../../../db/prisma.js';
import { changePassword, listAdmins, createAdminUser } from './admin-user-service.js';

type AnyFastify = FastifyInstance<any, any, any, any, any>;

/**
 * Admin 계정 관리 UI.
 * - 현재 계정 목록 + 마지막 로그인 · 로그인 수
 * - 비밀번호 변경 폼
 * - 신규 관리자 추가 (여러 관리자 가능)
 */

export async function registerPasswordRoutes(app: AnyFastify): Promise<void> {
  app.get('/admin/password', async (req, reply) => {
    const authUsername = extractBasicAuthUsername(req.headers.authorization);
    const admins = await listAdmins();
    const me = admins.find((a) => a.username === authUsername);

    const rows = admins
      .map(
        (a) => `
        <tr>
          <td><strong>${escape(a.username)}</strong>${a.username === authUsername ? ' <em>(나)</em>' : ''}</td>
          <td>${escape(a.displayName ?? '-')}</td>
          <td>${a.isActive ? '✅' : '⛔'}</td>
          <td>${a.loginCount}</td>
          <td>${a.lastLoginAt ? a.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : '-'}</td>
          <td>${a.createdAt.toISOString().slice(0, 10)}</td>
        </tr>`,
      )
      .join('');

    return reply.type('text/html').send(
      renderPage(
        'Admin 계정 관리',
        `
        <h2>등록된 관리자</h2>
        <table>
          <thead><tr>
            <th>Username</th><th>표시명</th><th>활성</th><th>로그인 수</th><th>마지막 로그인</th><th>생성일</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>

        ${me ? `
        <h2>내 비밀번호 변경</h2>
        <form method="POST" action="/admin/password/change">
          <label>현재 비밀번호</label>
          <input type="password" name="currentPassword" required>
          <label>새 비밀번호 (12자 이상)</label>
          <input type="password" name="newPassword" required minlength="12">
          <label>새 비밀번호 확인</label>
          <input type="password" name="newPasswordConfirm" required minlength="12">
          <input type="hidden" name="userId" value="${escape(me.id)}">
          <div class="actions">
            <button type="submit">비밀번호 변경</button>
          </div>
        </form>
        ` : ''}

        <h2>신규 관리자 추가</h2>
        <form method="POST" action="/admin/password/create">
          <label>Username</label>
          <input type="text" name="username" required pattern="[a-zA-Z0-9_.-]+" minlength="3">
          <label>표시명 (선택)</label>
          <input type="text" name="displayName">
          <label>초기 비밀번호 (12자 이상)</label>
          <input type="password" name="password" required minlength="12">
          <div class="actions">
            <button type="submit">계정 추가</button>
          </div>
        </form>

        <div class="hint">
          <strong>보안 팁:</strong> 부트스트랩 후 <code>.env</code>의 <code>ADMIN_PASSWORD</code>는 비워도 됩니다. DB 크레덴셜이 유일 진실 원본이 됩니다.
        </div>
        `,
      ),
    );
  });

  app.post<{ Body: { userId?: string; currentPassword?: string; newPassword?: string; newPasswordConfirm?: string } }>(
    '/admin/password/change',
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.userId || !b.currentPassword || !b.newPassword) {
        return reply.code(400).type('text/html').send(renderPage('실패', '필수 필드 누락.'));
      }
      if (b.newPassword !== b.newPasswordConfirm) {
        return reply.code(400).type('text/html').send(renderPage('실패', '새 비밀번호 확인이 일치하지 않습니다.'));
      }
      const res = await changePassword({
        userId: b.userId,
        currentPassword: b.currentPassword,
        newPassword: b.newPassword,
      });
      if (!res.success) {
        return reply.code(400).type('text/html').send(renderPage('실패', escape(res.message)));
      }
      logger.info({ userId: b.userId }, 'password changed via web');
      return reply
        .type('text/html')
        .send(
          renderPage(
            '변경 완료',
            `<p>비밀번호가 변경되었습니다. 다음 요청부터 새 비밀번호 사용.</p>
             <p><a href="/admin/password">← 계정 관리</a></p>`,
          ),
        );
    },
  );

  app.post<{ Body: { username?: string; displayName?: string; password?: string } }>(
    '/admin/password/create',
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.username || !b.password) {
        return reply.code(400).type('text/html').send(renderPage('실패', 'username · password 필수.'));
      }
      if (b.password.length < 12) {
        return reply.code(400).type('text/html').send(renderPage('실패', '비밀번호는 12자 이상.'));
      }
      const existing = await prisma.adminUser.findUnique({ where: { username: b.username } });
      if (existing) {
        return reply.code(400).type('text/html').send(renderPage('실패', `이미 존재하는 username: ${escape(b.username)}`));
      }
      await createAdminUser({
        username: b.username,
        password: b.password,
        displayName: b.displayName,
      });
      return reply.redirect('/admin/password');
    },
  );
}

function extractBasicAuthUsername(header: string | undefined): string | null {
  if (!header || !header.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    return decoded.split(':')[0] ?? null;
  } catch {
    return null;
  }
}

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><title>${escape(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:32px auto;padding:0 20px;color:#222;line-height:1.5}
h1{margin-bottom:16px}
h2{margin-top:32px;font-size:1.1em;color:#555;border-top:1px solid #eee;padding-top:20px}
table{width:100%;border-collapse:collapse;font-size:0.9em;margin-bottom:12px}
th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left}
th{background:#fafafa;font-weight:600}
label{display:block;font-weight:600;margin-top:12px;margin-bottom:4px;font-size:0.9em}
input[type=text],input[type=password]{width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
button{padding:8px 16px;background:#0969da;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.95em}
button:hover{background:#0860c7}
.actions{margin-top:16px}
.hint{margin-top:32px;padding:12px 16px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:4px;font-size:0.9em}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-size:0.9em}
a{color:#0969da}
em{color:#0969da;font-style:normal;font-size:0.85em}
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
