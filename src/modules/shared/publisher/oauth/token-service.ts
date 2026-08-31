import { prisma } from '../../../../db/prisma.js';
import { env } from '../../../../config/env.js';
import { ThreadsClient } from '../../../../infra/threads-client.js';
import { logger } from '../../../../config/logger.js';

const threads = new ThreadsClient();

const DEFAULT_PERSONA_PROMPT =
  '30-40대 주부 톤. 담백하고 진솔한 문체. 이모지는 절제 사용. 자세한 페르소나는 관리 화면에서 편집.';

export interface ConnectAccountResult {
  accountId: string;
  handle: string;
  threadsUserId: string;
  expiresAt: Date;
  isNew: boolean;
}

export async function connectAccountFromAuthCode(code: string): Promise<ConnectAccountResult> {
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) {
    throw new Error('META_APP_ID / META_APP_SECRET / META_REDIRECT_URI must be configured');
  }

  const short = await threads.exchangeCodeForShortLivedToken({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    code,
    redirectUri: env.META_REDIRECT_URI,
  });

  const long = await threads.exchangeShortForLongLivedToken({
    appSecret: env.META_APP_SECRET,
    shortLivedToken: short.accessToken,
  });

  const profile = await threads.fetchUserProfile(long.accessToken);

  const expiresAt = new Date(Date.now() + long.expiresIn * 1000);

  const existing = await prisma.account.findUnique({
    where: { threadsUserId: profile.id },
  });

  const account = await prisma.account.upsert({
    where: { threadsUserId: profile.id },
    create: {
      handle: profile.username,
      threadsUserId: profile.id,
      accessToken: long.accessToken,
      tokenExpiresAt: expiresAt,
      personaPrompt: DEFAULT_PERSONA_PROMPT,
      isActive: true,
    },
    update: {
      handle: profile.username,
      accessToken: long.accessToken,
      tokenExpiresAt: expiresAt,
      isActive: true,
    },
  });

  logger.info(
    { accountId: account.id, handle: account.handle, isNew: !existing, expiresAt },
    'Threads account connected'
  );

  return {
    accountId: account.id,
    handle: account.handle,
    threadsUserId: account.threadsUserId,
    expiresAt,
    isNew: !existing,
  };
}

export interface RefreshResult {
  accountId: string;
  handle: string;
  expiresAt: Date;
}

export async function refreshAccountToken(accountId: string): Promise<RefreshResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);

  const long = await threads.refreshLongLivedToken({ accessToken: account.accessToken });
  const expiresAt = new Date(Date.now() + long.expiresIn * 1000);

  await prisma.account.update({
    where: { id: accountId },
    data: { accessToken: long.accessToken, tokenExpiresAt: expiresAt },
  });

  logger.info({ accountId, handle: account.handle, expiresAt }, 'Threads token refreshed');

  return { accountId, handle: account.handle, expiresAt };
}

export async function refreshAllExpiringSoon(withinDays = 7): Promise<RefreshResult[]> {
  const threshold = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
  const candidates = await prisma.account.findMany({
    where: {
      isActive: true,
      tokenExpiresAt: { lte: threshold },
    },
  });

  const results: RefreshResult[] = [];
  for (const acc of candidates) {
    try {
      results.push(await refreshAccountToken(acc.id));
    } catch (err) {
      logger.error({ err, accountId: acc.id, handle: acc.handle }, 'Token refresh failed');
    }
  }
  return results;
}
