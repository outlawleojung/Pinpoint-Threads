/**
 * CLI: 등록된 AdminUser 목록 조회 (비밀번호 잊었을 때 username 확인용).
 * 사용: pnpm exec tsx scripts/list-admins.ts
 */
import { prisma } from '../src/db/prisma.js';

async function main(): Promise<void> {
  const users = await prisma.adminUser.findMany({
    select: { username: true, displayName: true, isActive: true, createdAt: true, loginCount: true, lastLoginAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\n=== 등록된 AdminUser ===\n');
  if (users.length === 0) {
    console.log('(없음)');
  } else {
    users.forEach((u, i) => {
      console.log(`${i + 1}. username:    ${u.username}`);
      console.log(`   displayName: ${u.displayName ?? '-'}`);
      console.log(`   isActive:    ${u.isActive}`);
      console.log(`   loginCount:  ${u.loginCount}`);
      console.log(`   lastLogin:   ${u.lastLoginAt?.toISOString() ?? '-'}`);
      console.log(`   createdAt:   ${u.createdAt.toISOString()}`);
      console.log('');
    });
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('실패:', err);
  await prisma.$disconnect();
  process.exit(1);
});
