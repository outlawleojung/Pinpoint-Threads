import type { NaverPostDraft } from '../naver-copywriter/schema.js';

export type PublishBlockType = 'TITLE' | 'HEADING' | 'PARAGRAPH' | 'IMAGE' | 'TAGS' | 'DISCLAIMER' | 'CTA';
export interface PublishBlock {
  type: PublishBlockType;
  text: string;
  note?: string;
  imageUrl?: string;
  url?: string;
}
export interface PublishPackage {
  blocks: PublishBlock[];
  plainText: string;
}

export function buildPublishPackage(
  draft: NaverPostDraft,
  imageUrls: string[],
  opts?: { includeDisclaimer?: boolean; connectUrl?: string },
): PublishPackage {
  const includeDisclaimer = opts?.includeDisclaimer ?? true;
  const connectUrl = opts?.connectUrl;
  const hasCta = typeof connectUrl === 'string' && connectUrl.length > 0;
  const blocks: PublishBlock[] = [];
  const imgQueue = [...imageUrls];

  blocks.push({ type: 'TITLE', text: draft.title, note: '제목란에 입력' });

  const emitImagesAfter = (sectionIndex: number) => {
    for (const slot of draft.imageSlots.filter((s) => s.afterSection === sectionIndex)) {
      const url = imgQueue.shift();
      blocks.push({
        type: 'IMAGE',
        text: slot.caption,
        imageUrl: url,
        note: url
          ? `여기에 이미지 삽입 (${slot.kind === 'PRODUCT' ? '상품 실물' : 'AI 보조'}): ${slot.caption}`
          : `이미지 필요(미확보): ${slot.caption}`,
      });
    }
  };

  blocks.push({ type: 'PARAGRAPH', text: draft.intro });
  if (includeDisclaimer) {
    blocks.push({ type: 'DISCLAIMER', text: draft.disclaimer, note: '첫 제휴 링크 전에 위치(공정위 필수)' });
  }
  emitImagesAfter(0);

  draft.sections.forEach((sec, i) => {
    blocks.push({ type: 'HEADING', text: sec.heading, note: '에디터에서 제목2 스타일 지정' });
    blocks.push({ type: 'PARAGRAPH', text: sec.body });
    emitImagesAfter(i + 1);
  });

  // 남은 이미지가 있으면 말미에 배치
  while (imgQueue.length) {
    const url = imgQueue.shift()!;
    blocks.push({ type: 'IMAGE', text: '추가 이미지', imageUrl: url, note: '적절한 위치에 삽입' });
  }

  if (hasCta) {
    blocks.push({
      type: 'CTA',
      text: '상품 확인하러 가기',
      url: connectUrl,
      note: '네이버 에디터에서 이 문구(또는 버튼/이미지)에 위 링크를 거세요',
    });
  }

  blocks.push({ type: 'TAGS', text: draft.tags.map((t) => `#${t}`).join(' '), note: '태그란에 입력' });

  const plainText = blocks
    .map((b) => {
      if (b.type === 'IMAGE') return `[이미지: ${b.text}]`;
      if (b.type === 'CTA') return `\n👉 상품 확인하러 가기: ${b.url ?? ''}\n`;
      return b.text;
    })
    .join('\n\n');

  return { blocks, plainText };
}
