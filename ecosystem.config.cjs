// pm2 프로세스 3개 — 로컬 `pnpm run dev / dev:bot / dev:worker` 와 같은 코드 경로를 tsx 로 실행 (watch 없음).
// 시작: pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
const common = {
  interpreter: 'node',
  interpreter_args: '--import tsx',
  env: { NODE_ENV: 'production', TZ: 'Asia/Seoul' },
  max_memory_restart: '1500M',
  restart_delay: 5000,
  time: true,
};

module.exports = {
  apps: [
    { name: 'api', script: 'src/index.ts', ...common },
    { name: 'worker', script: 'src/worker.ts', ...common },
    { name: 'bot', script: 'src/bot.ts', ...common },
  ],
};
