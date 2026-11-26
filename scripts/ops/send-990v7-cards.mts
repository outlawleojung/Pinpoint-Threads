import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';

const postIds = ['cmw6ihegg00028cxuxbauqo0k', 'cmw6ihtqm00018ca48ixvmk76'];

for (const id of postIds) {
  try {
    await sendApprovalRequest(id);
    console.log(`✅ 카드 발송: ${id}`);
  } catch (err) {
    console.error(`❌ 실패: ${id} — ${(err as Error).message}`);
  }
}

process.exit(0);
