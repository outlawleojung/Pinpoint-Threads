import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const MALE_KW = ['남성','남자','운동화','스니커즈','러닝화','에어포스','에어맥스','덩크','조던','뉴발란스','아식스','나이키','후드','맨투맨','바지','팬츠','슬랙스','청바지','데님'];
const FEMALE_KW = ['여성','여자','부츠','하이탑','뮬','로퍼','플랫','슬링백','힐','샌들','블라우스','스커트','원피스','니트','가디건'];

const defaultAcc = await prisma.account.findFirstOrThrow({ where: { handle: 'pikkseetem' } });
const minyoung = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });

const r = await runCustomPublish({
  accountId: defaultAcc.id,
  sourceUrl: 'https://www.threads.com/share/D_kPNR6W8',
  commerceUrl: 'https://link.coupang.com/a/iKTvdPiyCO',
  holdApproval: true,
  direction: '하입/FOMO 쇼핑 카피, 원작자 정황 재연 X, 반응·구매욕 1인칭만',
});

if (r.status !== 'PENDING_APPROVAL') {
  console.log(`❌ ${r.stage} | ${r.reason}`);
} else {
  const b = r.body.toLowerCase();
  const male = MALE_KW.filter(k => b.includes(k.toLowerCase())).length;
  const female = FEMALE_KW.filter(k => b.includes(k.toLowerCase())).length;
  const target = male > female ? 'minyoung.jung' : 'pikkseetem';
  
  console.log(`📝 ${r.body.replace(/\n/g,' ').slice(0,80)}`);
  console.log(`🎯 ${target}`);
  
  if (target === 'minyoung.jung') {
    await prisma.post.update({ where: { id: r.postId }, data: { accountId: minyoung.id } });
    console.log('→ minyoung.jung 재배정');
  }
  await sendApprovalRequest(r.postId);
  console.log(`✅ 카드 발송`);
}

await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
