// TODO(Phase 2): 원본 미디어 vs 커머스 썸네일 정합성 Vision 검증
export interface VisionMatchResult {
  matched: boolean;
  score: number;
  reason?: string;
}

export async function verifyProductMatch(_input: {
  sourceImageUrl: string;
  productThumbnailUrl: string;
}): Promise<VisionMatchResult> {
  throw new Error('verifyProductMatch not implemented (Phase 2)');
}
