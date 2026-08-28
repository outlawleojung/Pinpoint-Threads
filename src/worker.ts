import { installHttpDefaults } from './config/http.js';
installHttpDefaults();
import { logger } from './config/logger.js';
import { startAllWorkers } from './pipeline/workers.js';

const workers = startAllWorkers();

async function shutdown() {
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
