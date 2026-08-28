import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Cloudinary 미디어 어댑터.
 *
 * Threads Graph API가 발행 시 미디어 공개 URL을 요구하므로,
 * 소스에서 다운로드한 미디어를 Cloudinary에 업로드해 URL 확보.
 *
 * 무료 티어: 25 credits/월. 우리 규모(월 발행 500~1000건, 미디어 2GB 미만)는 여유.
 * 이관 이력: R2 → Cloudinary (카드 등록 회피).
 */

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary credentials missing in .env (CLOUD_NAME, API_KEY, API_SECRET)');
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export interface UploadResult {
  publicUrl: string;
  publicId: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  resourceType: 'image' | 'video' | 'raw' | 'auto';
}

export interface UploadFromUrlInput {
  sourceUrl: string;              // 원본 미디어의 공개 URL (소스 게시글의 이미지 URL 등)
  postId?: string;                // 우리 Post ID, 폴더 구조에 사용
  folder?: string;                // 하위 폴더 override
  resourceType?: 'image' | 'video' | 'auto';
}

/**
 * 원격 URL의 미디어를 Cloudinary에 mirror 업로드.
 * Cloudinary는 서버가 직접 원격 URL을 fetch → 우리가 다운로드하지 않아도 됨.
 */
export async function uploadFromUrl(input: UploadFromUrlInput): Promise<UploadResult> {
  ensureConfigured();
  const folder = input.folder ?? `${env.CLOUDINARY_UPLOAD_FOLDER}/${input.postId ?? 'misc'}`;

  const opts: UploadApiOptions = {
    folder,
    resource_type: input.resourceType ?? 'auto',
    overwrite: false,
    unique_filename: true,
    use_filename: false,
  };

  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader.upload(input.sourceUrl, opts, (err, res) => {
      if (err || !res) return reject(err ?? new Error('upload returned empty'));
      resolve(res);
    });
  });

  logger.debug({ publicId: result.public_id, bytes: result.bytes }, 'cloudinary upload done');

  return {
    publicUrl: result.secure_url,
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    resourceType: result.resource_type as UploadResult['resourceType'],
  };
}

/**
 * 여러 URL을 병렬 업로드.
 * Pipeline A/C의 "미디어 2개 이상" 하드 룰 지원.
 */
export async function uploadManyFromUrls(
  urls: string[],
  input: Omit<UploadFromUrlInput, 'sourceUrl'>,
): Promise<UploadResult[]> {
  return Promise.all(urls.map((sourceUrl) => uploadFromUrl({ ...input, sourceUrl })));
}

/**
 * 삭제 (실패한 Post 정리, 재활용 archive 시).
 */
export async function deleteMedia(publicId: string, resourceType: 'image' | 'video' = 'image') {
  ensureConfigured();
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}
