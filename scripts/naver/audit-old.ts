import { prisma } from '../../src/db/prisma.js';
import { llm } from '../../src/infra/llm/index.js';
import { fetchAutocomplete } from '../../src/infra/naver/autocomplete.js';
import { isFactFragile } from '../../src/modules/pipeline-d/demand/index.js';
import { buildInfoPost } from '../../src/modules/pipeline-d/info-post/index.js';

const CUTOFF = new Date('2026-09-09T00:00:00+09:00'); // 오늘 이전 = 옛 글

async function coreKeyword(title: string): Promise<string> {
  const res = await llm().complete({
    tier: 'main', temperature: 0, maxOutputTokens: 40, thinking: 'disabled',
    system: '너는 블로그 제목에서 "사람이 네이버에 실제로 칠 핵심 검색어" 하나만 뽑는다. 2~4어절, 다른 말 없이 검색어만 출력.',
    userParts: [{ type: 'text', text: title }],
  });
  return res.text.trim().replace(/["'\n]/g, '').split('\n')[0]!.slice(0, 30);
}

async function main() {
  const posts = await prisma.naverPost.findMany({
    where: { kind: 'INFO', createdAt: { lt: CUTOFF } },
    select: { id: true, title: true, category: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`옛 INFO 글 ${posts.length}건 점검\n`);

  const replace: { id: string; category: string | null; title: string; reason: string }[] = [];
  for (const p of posts) {
    const kw = await coreKeyword(p.title ?? '');
    const fragile = isFactFragile(p.title ?? '') || isFactFragile(kw);
    const ac = fragile ? [] : await fetchAutocomplete(kw, { max: 10 });
    const off = fragile || ac.length < 3;
    console.log(`${off ? '✗ 교체' : '✓ 유지'} | "${kw}" 수요 ${ac.length}${fragile ? ' [팩트취약]' : ''} | ${p.title}`);
    if (off) replace.push({ id: p.id, category: p.category, title: p.title ?? '', reason: fragile ? 'fragile' : `demand<3(${ac.length})` });
  }

  if (replace.length === 0) { console.log('\n교체 대상 없음'); return; }
  const byCat = new Map<string, number>();
  for (const r of replace) { const c = r.category ?? '자취 생활정보'; byCat.set(c, (byCat.get(c) ?? 0) + 1); }
  await prisma.naverPost.deleteMany({ where: { id: { in: replace.map((r) => r.id) } } });
  console.log(`\n삭제 ${replace.length}건. 카테고리별 재생성:`, [...byCat.entries()].map(([c, n]) => `${c}×${n}`).join(', '), '\n');

  let ok = 0, fail = 0;
  for (const [cat, n] of byCat) {
    for (let i = 0; i < n; i++) {
      try { const out = await buildInfoPost({ category: cat }); ok++; console.log(`  ✓ [${cat}] ${out.title}`); }
      catch (e) { fail++; console.log(`  ✗ [${cat}] ${(e as Error)?.message?.slice(0,80)}`); }
    }
  }
  console.log(`\n재생성: 성공 ${ok} / 실패 ${fail}`);
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
