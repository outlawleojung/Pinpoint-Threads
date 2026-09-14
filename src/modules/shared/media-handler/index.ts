import { uploadFromUrl, type UploadResult } from '../../../infra/cloudinary-client.js';
import { logger } from '../../../config/logger.js';

/**
 * Media Handler.
 * - 소스에서 다운로드한 미디어를 Cloudinary에 mirror
 * - Pipeline A/C의 "2개 이상" 하드 룰 강제 (1개면 error)
 * - 발행용 공개 URL 반환
 */

export const MEDIA_MIN_COUNT = 2;

export type MediaKind = 'image' | 'video';

export interface HandleMediaInput {
  postId: string;
  sourceMediaUrls: string[];
  /** sourceMediaUrls 각 항목 타입. 길이 다르거나 미제공 시 URL 확장자로 자동 판정. */
  sourceMediaTypes?: MediaKind[];
  requirePipelineC?: boolean;
}

export interface HandledMedia {
  publicUrls: string[];
  publicTypes: MediaKind[];
  raw: UploadResult[];
}

function inferKind(url: string): MediaKind {
  if (/\.mp4(?:\?|$)/i.test(url)) return 'video';
  return 'image';
}

export async function handleMedia(input: HandleMediaInput): Promise<HandledMedia> {
  if (input.sourceMediaUrls.length < MEDIA_MIN_COUNT) {
    throw new MediaValidationError(
      `Media count ${input.sourceMediaUrls.length} < required ${MEDIA_MIN_COUNT}`,
    );
  }

  const types: MediaKind[] = input.sourceMediaUrls.map((u, i) =>
    input.sourceMediaTypes?.[i] ?? inferKind(u),
  );

  // 각 URL 별로 image/video resource_type 지정해서 업로드.
  //   ★ 일부 실패(예: Cloudinary가 못 읽는 fbcdn 영상 "Unsupported video format")에 전체가 죽지 않게
  //     allSettled 로 성공분만 채택 · 실패는 스킵. (이미지 여러 장 멀쩡한데 영상 1개로 전체 실패 방지)
  const settled = await Promise.allSettled(
    input.sourceMediaUrls.map((sourceUrl, i) => {
      const resourceType: 'image' | 'video' = types[i] === 'video' ? 'video' : 'image';
      return uploadFromUrl({ sourceUrl, postId: input.postId, resourceType });
    }),
  );
  const uploads = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const failed = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
  if (failed.length > 0) {
    logger.warn(
      { postId: input.postId, failedCount: failed.length, reasons: failed.map((f) => String(f.reason?.message ?? f.reason).slice(0, 120)) },
      'media: 일부 업로드 실패 · 스킵하고 성공분으로 진행',
    );
  }
  if (uploads.length < MEDIA_MIN_COUNT) {
    throw new MediaValidationError(
      `업로드 성공 미디어 ${uploads.length}개 < 필요 ${MEDIA_MIN_COUNT}개 (실패 ${failed.length}건)`,
    );
  }

  logger.info(
    { postId: input.postId, count: uploads.length, skipped: failed.length },
    'media uploaded to cloudinary',
  );

  return {
    publicUrls: uploads.map((u) => u.publicUrl),
    publicTypes: uploads.map((u) => (u.resourceType === 'video' ? 'video' : 'image') as MediaKind),
    raw: uploads,
  };
}

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaValidationError';
  }
}

export { uploadFromUrl };
