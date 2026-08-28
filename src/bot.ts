import { bot } from './modules/shared/approval-gate/bot.js';
import { logger } from './config/logger.js';

async function start() {
  logger.info('Starting Telegram bot (long polling)...');
  await bot.start();
}

process.on('SIGINT', () => bot.stop());
process.on('SIGTERM', () => bot.stop());

start().catch((err) => {
  logger.error(err, 'Failed to start bot');
  process.exit(1);
});
