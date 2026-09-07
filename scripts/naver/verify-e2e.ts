import { handleNaverCommand } from '../../src/modules/shared/approval-gate/naver-command.js';

async function main() {
  const link = process.argv[2];
  if (!link) { console.error('사용법: verify-e2e.ts <실제 쇼핑커넥트 링크>'); process.exit(2); }
  const msg = await handleNaverCommand(link);
  console.log(msg);
  if (!msg.includes('발행 페이지')) throw new Error('발행 페이지 URL 누락');
  console.log('OK: e2e (실측) — 위 URL을 브라우저로 열어 블록/이미지 확인');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
