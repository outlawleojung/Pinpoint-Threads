import assert from 'node:assert';
import { handleNaverCommand } from '../../src/modules/shared/approval-gate/naver-command.js';

async function main() {
  const bad = await handleNaverCommand('');
  assert.ok(bad.includes('사용법'), '빈 입력 안내 누락');
  console.log('OK: /naver 입력 검증'); // 실 생성은 verify-builder full로 커버
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
