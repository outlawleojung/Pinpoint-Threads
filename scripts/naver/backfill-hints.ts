import { prisma } from '../../src/db/prisma.js';
import { llm } from '../../src/infra/llm/index.js';
import type { NaverPostDraft } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

// 기존 글의 각 소제목에 어울리는 상품 유형(productHint)을 채운다. 억지면 빈 문자열.
const SYSTEM = `너는 네이버 블로그 글의 각 소제목에 "자연스럽게 어울리는 상품 유형"을 한 줄로 붙이는 도구다.
규칙:
- 각 소제목 내용을 읽은 독자가 "이런 거 하나 있으면 좋겠다" 싶을 상품을 구체적 유형+선택 포인트로. 예: "신발장용 제습·탈취제(숯/실리카겔 타입)".
- 특정 브랜드·모델명 금지, 상품 "유형"으로만.
- 상품이 안 어울리는 소제목(개념 설명·계획·습관 등)은 빈 문자열 "".
- 출력은 순수 JSON: {"hints": ["...", "", ...]} — 배열 길이는 소제목 수와 정확히 같게. 다른 텍스트 금지.`;

async function main() {
  const posts = await prisma.naverPost.findMany({ where: { draftJson: { not: undefined } } });
  let ok = 0;
  for (const p of posts) {
    const draft = p.draftJson as unknown as NaverPostDraft;
    if (!draft?.sections?.length) continue;
    const list = draft.sections.map((s, i) => `${i + 1}. ${s.heading} — ${s.body.slice(0, 120)}`).join('\n');
    try {
      const res = await llm().complete({
        tier: 'main', system: SYSTEM, jsonMode: true, temperature: 0.5, maxOutputTokens: 1200, thinking: 'disabled',
        userParts: [{ type: 'text', text: `글 제목: ${p.title}\n소제목(${draft.sections.length}개):\n${list}\n\n각 소제목의 상품 유형을 hints 배열로.` }],
      });
      const m = res.text.match(/\{[\s\S]*\}/);
      const hints: string[] = m ? (JSON.parse(m[0]).hints ?? []) : [];
      draft.sections.forEach((s, i) => { s.productHint = typeof hints[i] === 'string' ? hints[i] : ''; });
      await prisma.naverPost.update({ where: { id: p.id }, data: { draftJson: draft as unknown as object } });
      ok += 1;
      const filled = draft.sections.filter((s) => s.productHint && s.productHint.trim()).length;
      console.log(`  ✓ ${p.title}  (힌트 ${filled}/${draft.sections.length})`);
    } catch (e) {
      console.log(`  ✗ ${p.id}: ${(e as Error)?.message?.slice(0, 80)}`);
    }
  }
  console.log(`\n완료: ${ok}건`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
