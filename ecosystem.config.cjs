// pm2 프로세스 3개 — 로컬 `pnpm run dev / dev:bot / dev:worker` 와 같은 코드 경로를 tsx 로 실행 (watch 없음).
// 시작: pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// 저메모리(램 1GB · GCP e2-micro): PINPOINT_APPS=worker,bot pm2 start ecosystem.config.cjs
//   api(Fastify)는 네이버 관리 페이지용이라 Threads 운영엔 불필요.
const apps = (process.env.PINPOINT_APPS ?? 'api,worker,bot').split(',').map((s) => s.trim());
const lowMem = require('os').totalmem() < 1.5 * 1024 ** 3;
const common = {
  interpreter: 'node',
  interpreter_args: '--import tsx',
  env: { NODE_ENV: 'production', TZ: 'Asia/Seoul' },
  max_memory_restart: lowMem ? '450M' : '1500M',
  restart_delay: 5000,
  time: true,
};

module.exports = {
  apps: [
    { name: 'api', script: 'src/index.ts', ...common },
    { name: 'worker', script: 'src/worker.ts', ...common },
    { name: 'bot', script: 'src/bot.ts', ...common },
  ].filter((a) => apps.includes(a.name)),
};
