import { generateNaverPost } from '../../src/modules/pipeline-d/naver-copywriter/index.js';

async function main() {
const draft = await generateNaverPost({
  topic: process.argv[2] ?? '겨울철 실내 건조, 가습기 없이 습도 올리는 법',
  product: { name: '미니 가습기', category: '생활가전' },
  connectUrl: 'https://example.com',
  kind: 'INFO',
});

const total =
  draft.intro.length + draft.sections.reduce((s, x) => s + x.body.length, 0);

console.log('■ 제목:', draft.title);
console.log('\n■ 인트로:\n' + draft.intro);
for (const [i, s] of draft.sections.entries()) {
  console.log(`\n■ 소제목 ${i + 1}: ${s.heading}\n${s.body}`);
}
console.log('\n■ 태그:', draft.tags.join(' '));
console.log(`\n[총 ${total}자 · 소제목 ${draft.sections.length}개]`);
}
main().catch((e) => { console.error(e); process.exit(1); });
