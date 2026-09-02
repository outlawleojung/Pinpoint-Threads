import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const links = await prisma.inboundLink.findMany({
    where: { receivedAt: { gte: todayStart } },
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true, platform: true, status: true, url: true,
      authorHandle: true, receivedAt: true, errorMessage: true,
      engagement: true, rawText: true,
    },
  });
  const benches = await prisma.benchmarkPost.findMany({
    where: { inboundLinkId: { in: links.map(l => l.id) } },
    select: { id: true, inboundLinkId: true, contentType: true, likesCount: true, repliesCount: true },
  });
  const benchByLinkId = new Map(benches.map(b => [b.inboundLinkId!, b]));
  console.log(`오늘 인바운드 총 ${links.length}건\n`);
  for (const l of links) {
    const kst = new Date(l.receivedAt.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 19);
    const b = benchByLinkId.get(l.id);
    const benchTag = b ? `⭐️ 승격 (${b.contentType}, likes=${b.likesCount}, replies=${b.repliesCount})` : '(미승격)';
    console.log(`── ${kst} KST @${l.authorHandle ?? '?'} · ${l.platform} · ${l.status} · ${benchTag}`);
    console.log(`   ${l.url}`);
    if (l.rawText) console.log(`   "${l.rawText.slice(0, 80).replace(/\n/g, ' ')}..."`);
    if (l.errorMessage) console.log(`   ⚠️ ${l.errorMessage}`);
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
