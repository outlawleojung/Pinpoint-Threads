/**
 * CLI: 관리자 계정 생성 (부트스트랩 및 이후 신규 추가).
 *
 * 사용:
 *   pnpm admin:create
 *   pnpm admin:create alice        (username 인자 지정)
 *
 * 안전:
 *   - 비밀번호는 stdin (echo off)로 입력 → 셸 히스토리 남지 않음
 *   - bcrypt 해싱 저장, 평문 보관 안 됨
 *   - 웹 접근 필요 없이 서버에서 직접 실행
 */

import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { createAdminUser } from '../src/modules/shared/admin/admin-user-service.js';
import { prisma } from '../src/db/prisma.js';

async function prompt(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  return new Promise((resolve) => {
    if (opts.hidden) {
      const origWrite = (stdout as any).write.bind(stdout);
      const origMuted = (rl as any)._writeToOutput;
      (rl as any)._writeToOutput = function (s: string) {
        if (s === question) origWrite(question);
        else origWrite('*');
      };
      rl.question(question, (answer) => {
        (rl as any)._writeToOutput = origMuted;
        stdout.write('\n');
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const usernameArg = argv[0];

  console.log('\n=== Pinpoint Threads · Admin 계정 생성 ===\n');

  const username =
    usernameArg?.trim() || (await prompt('Username: ')).trim();
  if (!username || !/^[a-zA-Z0-9_.-]+$/.test(username) || username.length < 3) {
    console.error('❌ username은 3자 이상 · 영숫자/._-만 허용');
    process.exit(1);
  }

  const existing = await prisma.adminUser.findUnique({ where: { username } });
  if (existing) {
    console.error(`❌ 이미 존재하는 username: ${username}`);
    process.exit(1);
  }

  const displayName = (await prompt('표시명 (선택, Enter로 skip): ')).trim() || undefined;

  const password = await prompt('비밀번호 (12자 이상): ', { hidden: true });
  if (password.length < 12) {
    console.error('❌ 비밀번호는 12자 이상');
    process.exit(1);
  }
  const passwordConfirm = await prompt('비밀번호 확인: ', { hidden: true });
  if (password !== passwordConfirm) {
    console.error('❌ 비밀번호 확인 불일치');
    process.exit(1);
  }

  const user = await createAdminUser({ username, password, displayName });
  console.log(`\n✅ 생성 완료`);
  console.log(`   Username: ${user.username}`);
  console.log(`   ID: ${user.id}`);
  console.log(`   Created: ${user.createdAt.toISOString()}`);
  console.log('');
  console.log('이제 /admin 접근 시 이 크레덴셜로 로그인.');
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('❌ 실패:', err);
  await prisma.$disconnect();
  process.exit(1);
});
