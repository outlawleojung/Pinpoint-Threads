// 쇼핑 소재 보관: '[["소스URL","상품 설명","쿠팡 파트너스 링크"], ...]' → 성별 기반 자동 계정 배정
// 명시 계정: 3번째 인자로 handle 지정 시 그 계정 고정
import { prisma } from '../../src/db/prisma.js';
import { runCustomPublish } from '../../src/modules/pipeline-a/custom-publish.js';
import { shutdownPlaywrightBrowser } from '../../src/infra/playwright-threads-video.js';

const items = JSON.parse(process.argv[2]!) as [string, string, string][];
const explicitHandle = process.argv[3] ?? null;

// 남성/유니섹스 키워드 → minyoung.jung, 여성 키워드 → pikkseetem
const MALE_KEYWORDS = ['남성', '남자', '운동화', '스니커즈', '러닝화', '에어포스', '에어맥스', '덩크', '조던', '뉴발란스', '아식스', '젤카야노', '나이키'];
const FEMALE_KEYWORDS = ['여성', '여자', '부츠', '하이탑', '실내화', '뮬', '로퍼', '플랫', '슬링백', '힐', '샌들'];

function pickHandle(desc: string): string {
  const d = desc.toLowerCase();
  if (FEMALE_KEYWORDS.some(k => d.includes(k.toLowerCase()))) return 'pikkseetem';
  if (MALE_KEYWORDS.some(k => d.includes(k.toLowerCase()))) return 'minyoung.jung';
  return 'pikkseetem'; // 기본값
}

for (const [url, desc, link] of items) {
  const handle = explicitHandle ?? pickHandle(desc);
  const acc = await prisma.account.findFirstOrThrow({ where: { handle } });
  const r = await runCustomPublish({
    accountId: acc.id, sourceUrl: url, commerceUrl: link, holdApproval: true,
    direction: `${desc} — 하입/FOMO 쇼핑 카피, 원작자 정황 재연 X, 반응·구매욕 1인칭만`,
  });
  console.log(r.status === 'PENDING_APPROVAL' ? `SHOP ${handle} | ${r.postId} | ${r.body.replace(/\n/g, ' / ').slice(0, 100)}` : `FAIL ${url} ${r.stage} ${r.reason}`);
}
await shutdownPlaywrightBrowser(); await prisma.$disconnect(); process.exit(0);
