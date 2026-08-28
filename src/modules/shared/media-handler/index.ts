import { uploadFromUrl, uploadManyFromUrls, type UploadResult } from '../../../infra/cloudinary-client.js';
import { logger } from '../../../config/logger.js';

/**
 * Media Handler.
 * - 소스에서 다운로드한 미디어를 Cloudinary에 mirror
 * - Pipeline A/C의 "2개 이상" 하드 룰 강제 (1개면 error)
 * - 발행용 공개 URL 반환
 */

export const MEDIA_MIN_COUNT = 2;

export interface HandleMediaInput {
  postId: string;
  sourceMediaUrls: string[];
  requirePipelineC?: boolean;   // C 파이프라인도 2개 이상 필수
}

export interface HandledMedia {
  publicUrls: string[];
  raw: UploadResult[];
}

export async function handleMedia(input: HandleMediaInput): Promise<HandledMedia> {
  if (input.sourceMediaUrls.length < MEDIA_MIN_COUNT) {
    throw new MediaValidationError(
      `Media count ${input.sourceMediaUrls.length} < required ${MEDIA_MIN_COUNT}`,
    );
  }

  const uploads = await uploadManyFromUrls(input.sourceMediaUrls, { postId: input.postId });
  logger.info({ postId: input.postId, count: uploads.length }, 'media uploaded to cloudinary');

  return {
    publicUrls: uploads.map((u) => u.publicUrl),
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
