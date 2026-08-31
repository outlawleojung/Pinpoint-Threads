import bcrypt from 'bcryptjs';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';

const BCRYPT_ROUNDS = 12;

export interface AdminUserView {
  id: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  loginCount: number;
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<AdminUserView | null> {
  if (!username || !password) return null;
  const user = await prisma.adminUser.findUnique({ where: { username } });
  if (!user || !user.isActive) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), loginCount: { increment: 1 } },
  });

  return toView(updated);
}

export async function createAdminUser(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<AdminUserView> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await prisma.adminUser.create({
    data: {
      username: input.username,
      passwordHash,
      displayName: input.displayName,
    },
  });
  logger.info({ username: user.username }, 'admin user created');
  return toView(user);
}

export async function upsertAdminUserFromEnv(
  username: string,
  password: string,
): Promise<AdminUserView> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.adminUser.upsert({
    where: { username },
    create: { username, passwordHash },
    update: { passwordHash },
  });
  logger.warn(
    { username },
    '⚠️ admin user bootstrapped/updated from env — .env에서 비번 제거 후 웹에서 변경 권장',
  );
  return toView(user);
}

export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{ success: boolean; message: string }> {
  const user = await prisma.adminUser.findUnique({ where: { id: input.userId } });
  if (!user) return { success: false, message: '사용자 없음' };

  const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!ok) return { success: false, message: '현재 비밀번호가 틀립니다' };

  if (input.newPassword.length < 12) {
    return { success: false, message: '새 비밀번호는 12자 이상' };
  }

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await prisma.adminUser.update({
    where: { id: input.userId },
    data: { passwordHash },
  });
  logger.info({ userId: user.id, username: user.username }, 'admin password changed');
  return { success: true, message: '변경 완료' };
}

export async function listAdmins(): Promise<AdminUserView[]> {
  const users = await prisma.adminUser.findMany({
    orderBy: { createdAt: 'asc' },
  });
  return users.map(toView);
}

export async function hasAnyAdmin(): Promise<boolean> {
  const c = await prisma.adminUser.count();
  return c > 0;
}

function toView(u: {
  id: string;
  username: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  loginCount: number;
}): AdminUserView {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    isActive: u.isActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastLoginAt: u.lastLoginAt,
    loginCount: u.loginCount,
  };
}
