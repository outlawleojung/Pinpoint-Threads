import { prisma } from '../../src/db/prisma.js';
import { ThreadsClient } from '../../src/infra/threads-client.js';
const c = new ThreadsClient();
const from = new Date(process.argv[2]!), to = new Date(process.argv[3]!);
const posts = await prisma.post.findMany({ where: { publishedAt: { gte: from, lt: to }, threadsPostId: { not: null } }, include: { account: true }, orderBy: { publishedAt: 'asc' } });
for (const p of posts) {
  let i: any = {}; let r: any = null;
  try { i = await c.fetchInsights({ accessToken: p.account.accessToken!, threadsPostId: p.threadsPostId! }); } catch (e) { i = { err: (e as Error).message.slice(0, 60) }; }
  if (p.threadsReplyId) { try { r = await c.fetchInsights({ accessToken: p.account.accessToken!, threadsPostId: p.threadsReplyId }); } catch {} }
  const t = p.publishedAt!.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
  console.log([t, p.account.handle, p.kind, `v${i.views ?? '-'}`, `l${i.likes ?? '-'}`, `c${i.replies ?? '-'}`, `rp${i.reposts ?? 0}`, r ? `댓글v${r.views}` : '', (p.generatedBody ?? '').replace(/\s+/g, ' ').slice(0, 40), i.err ?? ''].join(' | '));
}
// 비교 기준: 계정별 9/24~9/30 글 최신 스냅샷 조회수 중앙값
const base = await prisma.post.findMany({ where: { publishedAt: { gte: new Date('2026-09-24T00:00:00+09:00'), lt: from } }, include: { account: true, insightSnapshots: { orderBy: { collectedAt: 'desc' }, take: 1 } } });
const by: Record<string, Record<string, number[]>> = {};
for (const p of base) { const v = p.insightSnapshots[0]?.views; if (v == null) continue; ((by[p.account.handle] ??= {})[p.kind] ??= []).push(v); }
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const [h, k] of Object.entries(by)) console.log('BASE', h, Object.entries(k).map(([kk, a]) => `${kk} 중앙${med(a)}(n${a.length})`).join(' '));
await prisma.$disconnect(); process.exit(0);
