import assert from 'node:assert';
import { prisma } from '../../src/db/prisma.js';

async function main() {
  const cfg = await prisma.naverBlogConfig.findFirst();
  assert.ok(cfg, 'config 없음 — seed-config 먼저 실행');
  assert.ok(cfg.categories.length >= 1, 'categories 비어있음');
  console.log('OK: config', cfg.topic, cfg.categories);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
