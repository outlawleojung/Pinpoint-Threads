import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { promoteInboundLink } from '../src/modules/shared/source-collector/promoter.js';
import { InboundSource, InboundStatus } from '@prisma/client';

/**
 * MANUAL_TELEGRAM 으로 들어왔지만 승격 안 된 InboundLink 재승격.
 * 정책 변경 (2026-09-02): MANUAL_TELEGRAM 은 큐레이션 판단 있음 → likes 무관 자동 승격.
 * 이 스크립트는 정책 변경 이전에 fetch만 된 오래된 링크를 재처리.
 */
async function main() {
  const allLinks = await prisma.inboundLink.findMany({
    where: { source: InboundSource.MANUAL_TELEGRAM, status: InboundStatus.FETCHED },
    orderBy: { receivedAt: 'desc' },
    select: { id: true, authorHandle: true, url: true, receivedAt: true },
  });
  const promoted = await prisma.benchmarkPost.findMany({
    where: { inboundLinkId: { in: allLinks.map((l) => l.id) } },
    select: { inboundLinkId: true },
  });
  const promotedIds = new Set(promoted.map((p) => p.inboundLinkId));
  const links = allLinks.filter((l) => !promotedIds.has(l.id));

  console.log(`재승격 대상: ${links.length}건\n`);

  let ok = 0;
  let skip = 0;
  let fail = 0;
  for (const l of links) {
    try {
      const r = await promoteInboundLink(l.id, 'manual');
      const tag = r.status === 'promoted' ? '✅' : r.status === 'already_promoted' ? '🔁' : '⚠️';
      console.log(`${tag} @${l.authorHandle} · ${r.status} · ${r.reason ?? ''}`);
      if (r.status === 'promoted') ok += 1;
      else if (r.status === 'already_promoted') skip += 1;
      else fail += 1;
    } catch (err) {
      console.error(`❌ @${l.authorHandle} · ${(err as Error).message}`);
      fail += 1;
    }
  }
  console.log(`\n결과: 승격 ${ok} · 이미 승격됨 ${skip} · 실패 ${fail}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
