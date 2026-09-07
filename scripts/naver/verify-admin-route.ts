import assert from 'node:assert';
import { renderPublishPage } from '../../src/modules/shared/admin/naver-routes.js';
import { buildPublishPackage } from '../../src/modules/pipeline-d/publish-package/index.js';
import type { NaverPostDraft } from '../../src/modules/pipeline-d/naver-copywriter/schema.js';

const draft: NaverPostDraft = {
  title: 'T', intro: '결론 먼저 인트로 문단입니다 어쩌구', sections: [
    { heading: '소제목1', body: '본문1' }, { heading: '소제목2', body: '본문2' }, { heading: '소제목3', body: '본문3' },
  ], imageSlots: [
    { afterSection: 0, caption: 'c0', kind: 'PRODUCT' }, { afterSection: 1, caption: 'c1', kind: 'AI' }, { afterSection: 2, caption: 'c2', kind: 'PRODUCT' },
  ], tags: ['a', 'b', 'c', 'd', 'e'], disclaimer: '수수료 안내',
};
const pkg = buildPublishPackage(draft, ['https://img/1', 'https://img/2', 'https://img/3']);
const html = renderPublishPage({ id: 'x', title: 'T', state: 'PLANNED' }, pkg);
assert.ok(html.includes('제목2 스타일'), '소제목 가이드 렌더 누락');
assert.ok(html.includes('복사'), '복사 버튼 누락');
assert.ok(html.includes('https://img/1'), '이미지 미표시');
assert.ok(html.includes('여기에 이미지'), '이미지 자리 강조 문구 누락');

// 이미지 URL이 없는 경우(INFO 포스트 등)에도 자리 표시가 나와야 함
const pkgNoImages = buildPublishPackage(draft, []);
const htmlNoImages = renderPublishPage({ id: 'y', title: 'T', state: 'PLANNED' }, pkgNoImages);
assert.ok(htmlNoImages.includes('여기에 이미지 넣기'), '이미지 미확보 시 자리 표시 누락');

// AFFILIATE 포스트: connectUrl이 있으면 CTA 링크 배너가 렌더되어야 함
const connectUrl = 'https://shopping.link/connect/abc123';
const pkgWithCta = buildPublishPackage(draft, ['https://img/1', 'https://img/2', 'https://img/3'], { connectUrl });
const htmlWithCta = renderPublishPage({ id: 'z', title: 'T', state: 'PLANNED' }, pkgWithCta);
assert.ok(htmlWithCta.includes('상품 확인하러 가기'), 'CTA 배너 문구 누락');
assert.ok(htmlWithCta.includes(connectUrl), 'CTA 링크 URL 미표시');

console.log('OK: admin publish page render');
