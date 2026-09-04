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
export async function ensureBenchmarkVideo(
  benchmarkId: string | null,
  permalink: string | null | undefined,
  mediaUrls: string[],
): Promise<string[]> {
  const isThreads = permalink?.includes('threads.') ?? false;
  const hasMp4 = mediaUrls.some((u) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/'));
  if (!isThreads || hasMp4 || !permalink) return mediaUrls;

  try {
    const { extractThreadsVideoUrls, pickBestMp4s } = await import('../../infra/playwright-threads-video.js');
    // Playwright 추출이 불안정(될 때·안 될 때) → 최대 3회 재시도
    let bestMp4s: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { mp4Urls } = await extractThreadsVideoUrls(permalink);
      bestMp4s = pickBestMp4s(mp4Urls); // 최대 1개
      if (bestMp4s.length > 0) break;
      logger.info({ benchmarkId, attempt }, 'video-rescue: mp4 미발견 · 재시도');
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (bestMp4s.length === 0) {
      logger.info({ benchmarkId, permalink }, 'video-rescue: 3회 시도 후에도 비디오 없음 (실제 image-only)');
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
