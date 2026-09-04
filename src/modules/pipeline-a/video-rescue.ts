import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';

/**
 * Threads 벤치마크에 mp4 가 없으면 Playwright 로 비디오 재확인 · 복구.
 *
 * Apify 어댑터가 media_type 힌트를 못 잡거나 cover-frame 마커가 없으면
 * 실제 비디오 게시글도 image-only 로 저장됨. 발행 직전 이 함수로 구제.
 *
 * @returns 발행에 쓸 mediaUrls (비디오 있으면 mp4 를 앞에 붙인 것 · 없으면 원본)
 */
/**
 * @param hasVideo 사용자가 명시한 원본 비디오 유무.
 *   true  → mp4 확보까지 강하게 재시도 (원본에 비디오 확실히 있음)
 *   false → Playwright 스킵 (원본 이미지 전용 · 헛돎 방지)
 *   undefined → 자동 판단 (기존 동작 · 3회 재시도)
 */
export async function ensureBenchmarkVideo(
  benchmarkId: string | null,
  permalink: string | null | undefined,
  mediaUrls: string[],
  hasVideo?: boolean,
): Promise<string[]> {
  const isThreads = permalink?.includes('threads.') ?? false;
  const hasMp4 = mediaUrls.some((u) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/'));
  if (!isThreads || hasMp4 || !permalink) return mediaUrls;
  // 사용자가 "비디오 없음" 명시 → 스크래핑 스킵
  if (hasVideo === false) {
    logger.info({ benchmarkId }, 'video-rescue: 사용자 "비디오 없음" → 스킵');
    return mediaUrls;
  }

  // "비디오 있음" 이면 확보까지 강하게 (8회), 미지정이면 3회
  const maxAttempts = hasVideo === true ? 8 : 3;
  try {
    const { extractThreadsVideoUrls, pickBestMp4s } = await import('../../infra/playwright-threads-video.js');
    let bestMp4s: string[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { mp4Urls } = await extractThreadsVideoUrls(permalink);
      bestMp4s = pickBestMp4s(mp4Urls);
      if (bestMp4s.length > 0) break;
      logger.info({ benchmarkId, attempt, maxAttempts, hasVideo }, 'video-rescue: mp4 미발견 · 재시도');
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (bestMp4s.length === 0) {
      logger.warn({ benchmarkId, permalink, hasVideo }, `video-rescue: ${maxAttempts}회 시도 후에도 비디오 못 잡음`);
      return mediaUrls;
    }
    // 원본 이미지 유지 · mp4 를 앞에 (총 슬롯 max 10)
    const effective = [bestMp4s[0]!, ...mediaUrls].slice(0, 10);
    if (benchmarkId) {
      await prisma.benchmarkPost.update({
        where: { id: benchmarkId },
        data: { mediaUrls: effective },
      }).catch(() => {});
    }
    logger.info({ benchmarkId, before: mediaUrls.length, after: effective.length }, 'video-rescue: mp4 prepended');
    return effective;
  } catch (err) {
    logger.warn({ err, benchmarkId, permalink }, 'video-rescue failed · image-only');
    return mediaUrls;
  }
}
