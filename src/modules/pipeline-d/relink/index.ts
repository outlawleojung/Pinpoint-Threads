import { prisma } from '../../../db/prisma.js';
import { env } from '../../../config/env.js';
import { generateNaverPost } from '../naver-copywriter/index.js';
import type { NaverPostDraft } from '../naver-copywriter/schema.js';
import { resolveConnectUrl, fetchProductInfo } from '../../../infra/naver/smartstore-detail.js';

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

  // 커넥트 링크 → 최종 상품페이지 URL → 상품명·이미지 스크랩(제목 추측 대신 실물 정보 우선).
  const finalUrl = await resolveConnectUrl(connectUrl);
  const info = await fetchProductInfo(finalUrl, { maxImages: 6 });

  const productName =
    info.name ?? post.suggestedProduct ?? post.title ?? post.category ?? post.topic;

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
      imageUrls: info.images.length > 0 ? info.images : post.imageUrls,
      suggestedProduct: info.name ?? post.suggestedProduct,
    },
  });

  return {
    title: newDraft.title,
    pageUrl: `http://localhost:${env.APP_PORT}/admin/naver/${postId}`,
  };
}

/**
 * 문단별 제휴 링크 부착 — 글은 재생성하지 않고, 지정한 소제목(section) 뒤에 상품 CTA만 추가한다.
 * section: 0 = 도입(intro) 뒤, 1..N = N번째 소제목 뒤. 같은 section에 다시 걸면 교체.
 * 여러 번 호출하면 여러 소제목에 각각 링크가 붙는다.
 */
export async function addSectionLink(
  postId: string,
  section: number,
  connectUrl: string,
  label?: string,
): Promise<{ title: string; pageUrl: string; linkCount: number; sectionCount: number } | { error: string }> {
  const post = await prisma.naverPost.findUnique({ where: { id: postId } });
  if (!post) return { error: `글을 찾을 수 없습니다: ${postId}` };
  if (!post.draftJson) return { error: '이 글은 아직 본문이 없습니다.' };

  const draft = post.draftJson as unknown as NaverPostDraft;
  const sectionCount = draft.sections?.length ?? 0;
  if (section < 0 || section > sectionCount) {
    return { error: `소제목 번호는 0(도입)~${sectionCount} 사이여야 합니다. 받은 값: ${section}` };
  }

  const links = (draft.sectionLinks ?? []).filter((l) => l.section !== section);
  links.push({ section, url: connectUrl, ...(label ? { label } : {}) });
  links.sort((a, b) => a.section - b.section);
  const nextDraft = { ...draft, sectionLinks: links };

  await prisma.naverPost.update({
    where: { id: postId },
    data: {
      kind: 'AFFILIATE',
      draftJson: nextDraft as unknown as object,
      connectUrl: post.connectUrl ?? connectUrl, // 대표 링크(최초 1개) 기록용
    },
  });

  return {
    title: post.title ?? '(제목 미정)',
    pageUrl: `http://localhost:${env.APP_PORT}/admin/naver/${postId}`,
    linkCount: links.length,
    sectionCount,
  };
}
