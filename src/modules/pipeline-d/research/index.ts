import { llm } from '../../../infra/llm/index.js';
import { logger } from '../../../config/logger.js';

/**
 * 웹 그라운딩 — 글 쓰기 전에 실제 웹을 검색해 "검증된 구체 사실"을 모은다.
 * 본문이 LLM 뇌피셜이 아니라 실제 근거에 기반하도록 하는 단계.
 * 실패/빈 결과면 '' 반환(copywriter는 근거 없이 진행).
 */
const SYSTEM = `너는 블로그 글을 위한 리서처다. 주어진 주제를 웹에서 검색해, 글에 그대로 쓸 수 있는 "검증된 구체 사실"만 정리한다.
규칙:
- 일반론("잘 관리하세요")·뻔한 말 금지. 구체 수치·기준·규격·방법·순서·흔한 실수·주의점 위주.
- 각 항목은 한 줄 사실 + (가능하면 근거/출처 힌트). 서로 다른 각도로 8~15개.
- 웹에서 확인 안 되는 내용은 넣지 마라(지어내기 금지).
- 지역·시점마다 다른 값(가격·행정절차 등)은 "지역/시점 따라 다름"이라고 명시.
- 한국어 불릿(-)으로만 출력. 서론·맺음말 없이 사실 목록만.`;

export async function researchTopic(angle: string): Promise<string> {
  try {
    const res = await llm().complete({
      tier: 'main',
      system: SYSTEM,
      webSearch: { maxUses: 5 },
      maxOutputTokens: 2500,
      temperature: 0.3,
      userParts: [{ type: 'text', text: `주제: ${angle}\n이 주제로 블로그 글을 쓸 때 필요한 구체 사실을 웹에서 찾아 정리해라.` }],
    });
    const digest = res.text.trim();
    const bulletCount = (digest.match(/^\s*[-•]/gm) ?? []).length;
    logger.info({ angle, bulletCount, len: digest.length }, '웹 리서치 완료');
    return bulletCount >= 3 ? digest : '';
  } catch (err) {
    logger.warn({ err: (err as Error).message, angle }, '웹 리서치 실패 — 근거 없이 진행');
    return '';
  }
}
