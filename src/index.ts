import { installHttpDefaults } from './config/http.js';
installHttpDefaults();
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import formbody from '@fastify/formbody';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { registerThreadsOAuthRoutes } from './modules/shared/publisher/oauth/routes.js';
import { registerPersonaRoutes } from './modules/shared/admin/persona-routes.js';
import { registerTrendsRoutes } from './modules/shared/admin/trends-routes.js';

async function bootstrap() {
  const app = Fastify({ loggerInstance: logger });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors);
  await app.register(formbody);

  app.get('/healthz', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  await registerThreadsOAuthRoutes(app);
  await registerPersonaRoutes(app);
  await registerTrendsRoutes(app);

  await app.listen({ port: env.APP_PORT, host: '0.0.0.0' });
  logger.info(`🚀 API listening on :${env.APP_PORT}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to bootstrap API');
  process.exit(1);
});
