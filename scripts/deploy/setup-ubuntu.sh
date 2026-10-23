#!/usr/bin/env bash
# 우분투 서버(Oracle 무료 ARM · Lightsail 등) 한 번에 셋업 — 여러 번 실행해도 안전.
# 사용: 서버에서  bash scripts/deploy/setup-ubuntu.sh   (저장소 루트에서, .env 를 먼저 복사해 둘 것)
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  echo "❌ .env 없음 — 로컬에서 scp .env ubuntu@<서버IP>:~/Pinpoint-Threads/.env 먼저" >&2
  exit 1
fi

echo "▶ 시간대 KST (발행 시간창이 서버 시각 기준)"
sudo timedatectl set-timezone Asia/Seoul

echo "▶ 기본 패키지 · Redis · Python(Pillow, frame-grid 용)"
sudo apt-get update -y
sudo apt-get install -y curl git build-essential redis-server python3 python3-pil
sudo systemctl enable --now redis-server

# 램 1.5GB 미만(GCP e2-micro 등) = 저메모리 모드: 스왑 4GB · api 프로세스 제외
MEM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$MEM_KB" -lt 1572864 ]; then LOWMEM=1; SWAP=4G; else LOWMEM=0; SWAP=2G; fi
echo "▶ 스왑 $SWAP (Playwright 크롬 메모리 여유 · 저메모리=$LOWMEM)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l $SWAP /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "▶ Node 22 · pnpm · pm2"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo corepack enable
corepack prepare pnpm@9.12.1 --activate
command -v pm2 >/dev/null || sudo npm install -g pm2

echo "▶ 의존성 · Prisma · Playwright 크롬"
pnpm install --frozen-lockfile
npx prisma generate
npx playwright install --with-deps chromium

echo "▶ 방화벽: SSH 만 (봇은 텔레그램 polling 이라 들어오는 포트 불필요)"
if command -v ufw >/dev/null; then
  sudo ufw allow OpenSSH && sudo ufw --force enable
fi

if [ "$LOWMEM" = 1 ]; then START='PINPOINT_APPS=worker,bot pm2 start ecosystem.config.cjs'; else START='pm2 start ecosystem.config.cjs'; fi
cat <<EOF

✅ 셋업 완료. 다음 순서 (docs/03-infrastructure/migration-handoff.md 3절):
  1) 옛 서버가 꺼져 있는지 확인 (봇 2개 동시 실행 금지)
  2) npx tsx scripts/ops/reschedule-approved.mts
  3) $START && pm2 save && pm2 startup   (마지막 줄이 출력하는 sudo 명령 한 번 실행)
  4) pm2 logs  ·  npx tsx scripts/ops/queue-status.mts
EOF
