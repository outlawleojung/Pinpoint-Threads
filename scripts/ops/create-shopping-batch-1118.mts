import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const items = [
  { url: 'https://www.threads.com/share/GTtLbuzwu', link: 'https://www.musinsa.com/curator/goods/mCFlpDFP' },
  { url: 'https://www.threads.com/share/GF8fvDpew', link: 'https://www.musinsa.com/curator/goods/bZDSS8rx' },
];

const MALE_KW = ['남성','남자','운동화','스니커즈','러닝화','에어포스','에어맥스','덩크','조던','뉴발란스','아식스','젤카야노','나이키','후드','맨투맨','바지','팬츠','슬랙스','청바지','데님'];
const FEMALE_KW = ['여성','여자','부츠','하이탑','뮬','로퍼','플랫','슬링백','힐','샌들','블라우스','스커트','원피스','니트','가디건'];

function pickByBody(body: string): string {
  const b = body.toLowerCase();
  const maleHits = MALE_KW.filter(k => b.includes(k.toLowerCase())).length;
  const femaleHits = FEMALE_KW.filter(k => b.includes(k.toLowerCase())).length;
  if (maleHits > femaleHits) return 'minyoung.jung';
  if (femaleHits > maleHits) return 'pikkseetem';
  return 'pikkseetem'; // 기본
}

const BASE_DIR = '하입/FOMO 쇼핑 카피, 원작자 정황 재연 X, 반응·구매욕 1인칭만';

// 먼저 pikkseetem으로 생성 → 카피 보고 남성향이면 minyoung.jung으로 재배정
const defaultAcc = await prisma.account.findFirstOrThrow({ where: { handle: 'pikkseetem' } });
const minyoung = await prisma.account.findFirstOrThrow({ where: { handle: 'minyoung.jung' } });

for (let i = 0; i < items.length; i++) {
  const item = items[i]!;
  console.log(`\n🛍 [${i+1}/${items.length}] ${item.url.slice(-12)}`);
  
  try {
    const r = await runCustomPublish({
      accountId: defaultAcc.id,
      sourceUrl: item.url,
      commerceUrl: item.link,
      holdApproval: true,
      direction: BASE_DIR,
    });

    if (r.status !== 'PENDING_APPROVAL') {
      console.log(`❌ ${r.stage} | ${r.reason}`);
      continue;
    }

    // 카피 기반 성별 판단
    const targetHandle = pickByBody(r.body);
    console.log(`📝 카피: ${r.body.replace(/\n/g,' ').slice(0,80)}`);
    console.log(`🎯 성별 라우팅: ${targetHandle}`);

    if (targetHandle === 'minyoung.jung') {
      await prisma.post.update({ where: { id: r.postId }, data: { accountId: minyoung.id } });
      console.log(`  → minyoung.jung 재배정`);
    }

    await sendApprovalRequest(r.postId);
    console.log(`✅ ${targetHandle} | 카드 발송`);
  } catch (err: any) {
    console.error(`❌ 실패:`, err.message);
  }
}

await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
