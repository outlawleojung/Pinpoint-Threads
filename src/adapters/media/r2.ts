// TODO(Phase 2): Cloudflare R2 (S3 호환) 미디어 업로드
// Threads Graph API는 공개 URL을 요구하므로 원본 미디어를 R2에 미러링 후 URL 반환.

export interface UploadResult {
  publicUrl: string;
  key: string;
}

export async function uploadMedia(_input: {
  buffer: Buffer;
  contentType: string;
  filename?: string;
}): Promise<UploadResult> {
  throw new Error('uploadMedia not implemented (Phase 2)');
}
