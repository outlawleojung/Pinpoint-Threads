import { installHttpDefaults } from './config/http.js';
installHttpDefaults();
import { logger } from './config/logger.js';
import { startAllWorkers } from './pipeline/workers.js';
import { startTrendWorkers, scheduleTrendJobs } from './pipeline/trend-workers.js';

const workers = [...startAllWorkers(), ...startTrendWorkers()];

scheduleTrendJobs().catch((err) => {
  logger.error(err, 'failed to schedule trend jobs');
});

async function shutdown() {
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
