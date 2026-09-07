import assert from 'node:assert';
import { buildPublishPackage } from '../../src/modules/pipeline-d/publish-package/index.js';
import type { NaverPostDraft } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

const draft: NaverPostDraft = {
  title: '무선 가습기 추천 3개월 실사용 후기',
  intro: '결론부터. 저소음·USB 충전 원하면 이거 하나로 끝납니다. 3개월 써본 솔직 후기예요.',
  sections: [
    { heading: '왜 이 가습기인가', body: '책상 위 공간을 거의 안 잡아먹습니다. ...' },
    { heading: '실사용 소음 체크', body: '밤에 틀어도 거슬리지 않는 수준. ...' },
    { heading: '단점도 솔직히', body: '물통이 작아 자주 채워야 합니다. ...' },
  ],
  imageSlots: [
    { afterSection: 0, caption: '제품 정면', kind: 'PRODUCT' },
    { afterSection: 1, caption: '소음 측정 그래픽', kind: 'AI' },
    { afterSection: 2, caption: '물통 크기 비교', kind: 'PRODUCT' },
  ],
  tags: ['무선가습기', '가습기추천', '저소음가습기', 'USB가습기', '생활템'],
  disclaimer: '본 포스팅은 네이버 쇼핑커넥트 활동의 일환으로, 구매 발생 시 일정액의 수수료를 제공받습니다.',
};

const pkg = buildPublishPackage(draft, ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg']);
assert.equal(pkg.blocks[0]!.type, 'TITLE');
const headings = pkg.blocks.filter((b) => b.type === 'HEADING');
assert.ok(headings.every((h) => h.note?.includes('제목2')), '소제목 스타일 안내 누락');
const images = pkg.blocks.filter((b) => b.type === 'IMAGE');
assert.equal(images.length, 3);
assert.ok(images.every((i) => i.imageUrl), '이미지 URL 미배정');
assert.ok(pkg.blocks.some((b) => b.type === 'DISCLAIMER'));
assert.ok(pkg.plainText.includes('무선 가습기 추천'));
console.log('OK: publish package renderer');
