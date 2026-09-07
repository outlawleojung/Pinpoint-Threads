import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';
import { generateNaverPost } from '../naver-copywriter/index.js';
import type { NaverPostDraft } from '../naver-copywriter/schema.js';

/**
 * /naverlink — 기존 INFO(일상) 네이버 글을 AFFILIATE(제휴)로 재생성한다.
 * 정보 리드는 유지하되, 상품을 자연스럽게 소개하고 쇼핑커넥트 링크를 자연스러운 위치에 배치.
 * 이미 AFFILIATE/커넥트가 있어도 재-링크(덮어쓰기) 허용.
 */
export async function relinkNaverPost(
  postId: string,
  connectUrl: string,
): Promise<{ title: string; pageUrl: string } | { error: string }> {
  const post = await prisma.naverPost.findUnique({ where: { id: postId } });
  if (!post) return { error: `글을 찾을 수 없습니다: ${postId}` };

  const productName = post.suggestedProduct ?? post.title ?? post.category ?? post.topic;

  const newDraft: NaverPostDraft = await generateNaverPost({
    topic: post.topic,
    product: { name: productName, category: post.category ?? undefined },
    connectUrl,
    kind: 'AFFILIATE',
    extraNote:
      '기존 정보성 글의 유용한 정보 리드를 유지하되, ' +
      productName +
      '를 자연스럽게 소개하고 본문 중 자연스러운 위치에 제휴 링크를 배치하라. 광고 티가 나지 않게, 정보 가치를 우선하라.',
  });

  await prisma.naverPost.update({
    where: { id: postId },
    data: {
      kind: 'AFFILIATE',
      connectUrl,
      draftJson: newDraft as unknown as object,
      title: newDraft.title,
      // imageUrls는 기존 값 유지(명시적으로 건드리지 않음)
    },
  });

  return {
    title: newDraft.title,
    pageUrl: `http://localhost:${env.APP_PORT}/admin/naver/${postId}`,
  };
}
