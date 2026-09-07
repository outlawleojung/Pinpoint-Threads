import { generateNaverPost } from '../../src/modules/pipeline-d/naver-copywriter/index.js';
import { NaverPostDraftSchema } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

async function main() {
  const draft = await generateNaverPost({
    topic: '뷰티·생활템',
    product: { name: '휴대용 무선 가습기 500ml', price: 24900, category: '생활용품', specs: '500ml, USB 충전, 저소음' },
    connectUrl: 'https://smartstore.naver.com/x/products/1',
    kind: 'AFFILIATE',
  });
  NaverPostDraftSchema.parse(draft); // 스키마 위반 시 throw
  console.log('title:', draft.title, `(${draft.title.length}자)`);
  console.log('sections:', draft.sections.length, '| imageSlots:', draft.imageSlots.length, '| tags:', draft.tags.length);
  const full = [draft.intro, ...draft.sections.map((s) => s.body)].join('\n');
  console.log('본문 대략 길이:', full.length, '자');
  if (!draft.disclaimer.includes('수수료')) throw new Error('공정위 문구 누락');
  if (draft.title.length > 80) throw new Error('제목 80자 초과');
  console.log('OK: naver copywriter (실측)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
