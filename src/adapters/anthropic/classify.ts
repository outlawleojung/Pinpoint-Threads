// TODO(Phase 2): 원문/미디어 기반 소비재 적합성 판정 + 카테고리 + 쿠팡/무신사 검색용 키워드 추출
export interface ClassifyResult {
  suitable: boolean;
  category?: string;
  searchKeyword?: string;
  reason?: string;
}

export async function classifySourceItem(_input: {
  text: string;
  mediaUrls: string[];
}): Promise<ClassifyResult> {
  throw new Error('classifySourceItem not implemented (Phase 2)');
}
