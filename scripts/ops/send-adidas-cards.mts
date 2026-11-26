import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const postIds = ['cmw6ic4kw00028cejo4w65kfj', 'cmw6ic8ms00058cej6g0ryxww'];

for (const id of postIds) {
  try {
    await sendApprovalRequest(id);
    console.log(`✅ 카드 발송: ${id}`);
  } catch (err) {
    console.error(`❌ 실패: ${id} — ${(err as Error).message}`);
  }
}

process.exit(0);
