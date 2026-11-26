// 2026-11-17 1차 쇼핑 목록 — 성별 자동 라우팅 + holdApproval
import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { sendApprovalRequest } from '../../src/modules/shared/approval-gate/service.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const items: { url: string; link: string; direction?: string }[] = [
  { url: 'https://www.threads.com/share/LJbxsmcnm', link: 'https://link.coupang.com/a/iKO18Xn24W' },
  { url: 'https://www.threads.com/share/DeEr1TXpf', link: 'https://link.coupang.com/a/iKO7N7FFdY', direction: '그냥 로퍼에 빨간 양말이 어울린다는 컨셉' },
  { url: 'https://www.threads.com/share/EI7SbQerD', link: 'https://link.coupang.com/a/iKPcvXizsq' },
  { url: 'https://www.threads.com/share/Bnd6l1_bf1', link: 'https://link.coupang.com/a/iKPioDMdcy' },
  { url: 'https://www.threads.com/share/F_EkrVM1b', link: 'https://link.coupang.com/a/iKPwnrk4Lk' },
  { url: 'https://www.threads.com/share/HXAXyHDiU', link: 'https://link.coupang.com/a/iKPCXPh4oe' },
];

// 남성/유니섹스 → minyoung.jung, 여성 → pikkseetem
const MALE_KEYWORDS = ['남성', '남자', '운동화', '스니커즈', '러닝화', '에어포스', '에어맥스', '덩크', '조던', '뉴발란스', '아식스', '젤카야노', '나이키'];
const FEMALE_KEYWORDS = ['여성', '여자', '부츠', '하이탑', '실내화', '뮬', '로퍼', '플랫', '슬링백', '힐', '샌들'];

function pickHandle(desc: string): string {
  const d = desc.toLowerCase();
  if (FEMALE_KEYWORDS.some(k => d.includes(k.toLowerCase()))) return 'pikkseetem';
  if (MALE_KEYWORDS.some(k => d.includes(k.toLowerCase()))) return 'minyoung.jung';
  return 'pikkseetem'; // 기본값
}

const BASE_DIRECTION = '하입/FOMO 쇼핑 카피, 원작자 정황 재연 X, 반응·구매욕 1인칭만';

for (let i = 0; i < items.length; i++) {
  const item = items[i]!;
  const direction = item.direction
    ? `${item.direction} — ${BASE_DIRECTION}`
    : BASE_DIRECTION;

  // 성별 판단을 위해 일단 기본 라우팅 (소스에서 상품 정보 나오면 그때 결정)
  // 로퍼 → 여성
  const handle = item.direction ? pickHandle(item.direction) : 'pikkseetem';
  const acc = await prisma.account.findFirstOrThrow({ where: { handle } });

  console.log(`\n🛍 [${i + 1}/${items.length}] ${handle} ← ${item.url.slice(-15)}`);
  try {
    const r = await runCustomPublish({
      accountId: acc.id,
      sourceUrl: item.url,
      commerceUrl: item.link,
      holdApproval: true,
      direction,
    });
    if (r.status === 'PENDING_APPROVAL') {
      await sendApprovalRequest(r.postId);
      console.log(`✅ ${handle} | 카드 발송 | ${r.body.replace(/\n/g, ' / ').slice(0, 80)}`);
    } else {
      console.log(`❌ ${handle} | ${r.stage} | ${r.reason}`);
    }
  } catch (err: any) {
    console.error(`❌ ${handle} 실패:`, err.message);
  }
}

await shutdownPlaywrightBrowser();
await prisma.$disconnect();
process.exit(0);
