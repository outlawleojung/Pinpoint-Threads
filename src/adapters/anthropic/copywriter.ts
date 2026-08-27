// TODO(Phase 2): 페르소나 기반 본문 + 쿠팡 링크 대댓글 카피 생성
export interface CopywriteInput {
  sourceText: string;
  productName: string;
  category?: string;
  personaPrompt: string;
  accountSeed: string;
}

export interface CopywriteResult {
  body: string;
  reply: string;
}

export async function generateCopy(_input: CopywriteInput): Promise<CopywriteResult> {
  throw new Error('generateCopy not implemented (Phase 2)');
}

export const LEGAL_DISCLAIMER =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
