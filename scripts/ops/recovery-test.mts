// 휴식 계정 회복 테스트: 소재 감시 후보를 휴식 계정마다 1건씩 배정(allowInactive) → 카드. 24h 20뷰+ 면 회복.
import { prisma } from '../../src/db/prisma.js';
import { runSourceWatch, sourceWatchReport } from '../../src/modules/pipeline-c/source-watch.js';
const handles = process.argv.slice(2);
const accs = await prisma.account.findMany({ where: { handle: { in: handles }, isActive: false }, select: { id: true, handle: true } });
console.log('TARGETS', accs.map((a) => a.handle).join(', '));
const s = await runSourceWatch({ targets: accs });
console.log('REPORT\n' + sourceWatchReport(s));
await prisma.$disconnect();
process.exit(0);
