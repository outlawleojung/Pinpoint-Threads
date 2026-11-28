// 옛 공식 로직으로 생성된 스하리 4건 REJECT 후 새 LLM 로직으로 재생성
import { prisma } from '../../src/db/prisma.js';
import { runSharingForAllAccounts } from '../../src/modules/pipeline-b/sharing-publisher/orchestrator.js';

const BLOCKER_IDS = [
  'cmx0jo7x70003iff4tj6vqifj', // hanseoa.pick PENDING
  'cmwyve5ip0030ifex0ghrd8ov', // minyoung.jung APPROVED
  'cmwyve8ib0032ifex2369mh3e', // pikkseetem APPROVED
  'cmww0ihvd004cifqwtbbx12ip', // kle0_lee APPROVED (연속 블로커)
];

console.log('═══ [1] 옛 공식 스하리 4건 REJECT ═══');
for (const id of BLOCKER_IDS) {
  const p = await prisma.post.findUnique({
    where: { id },
    select: { state: true, generatedBody: true, account: { select: { handle: true } } },
  });
  if (!p) { console.log(`  ${id}: NOT FOUND, skip`); continue; }
  await prisma.post.update({
    where: { id },
    data: {
      state: 'REJECTED',
      rejectionReason: '옛 공식 풀 로직 바디 — 새 LLM 로직으로 교체 (2026-11-29)',
    },
  });
  console.log(`  REJECT @${p.account.handle} [${p.state}] "${p.generatedBody}"`);
}

console.log('\n═══ [2] 새 로직으로 전 계정 재생성 ═══');
const summary = await runSharingForAllAccounts();
console.log(`\ntotal: ${summary.total}, sent: ${summary.sent}, skipped: ${summary.skipped}, failed: ${summary.failed}`);
for (const a of summary.perAccount) {
  console.log(`  @${a.handle.padEnd(16)} [${a.status}] ${a.reason ?? ''}`);
}

console.log('\n═══ [3] 생성된 바디 확인 ═══');
const fresh = await prisma.post.findMany({
  where: {
    kind: 'SHARING',
    state: 'PENDING_APPROVAL',
    createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
  },
  select: { id: true, generatedBody: true, scheduledAt: true, account: { select: { handle: true } } },
  orderBy: { createdAt: 'desc' },
});
for (const p of fresh) {
  console.log(`\n@${p.account.handle} (${p.id})`);
  if (p.scheduledAt) console.log(`  예약: ${p.scheduledAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log(`  ${p.generatedBody}`);
}

process.exit(0);
