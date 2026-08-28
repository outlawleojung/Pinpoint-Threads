import { createHash } from 'node:crypto';

/**
 * Reply Composer (고정 댓글) — Pipeline A 전용.
 * 4가지 실전 양식 중 계정×요일 해시로 안정적 다변화.
 * 공정위 필수 문구 강제.
 * 자세한 사양: docs/09-agents/pipeline-a/reply-composer.md
 */

export const LEGAL_DISCLAIMER =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

export type ReplyVariant = 1 | 2 | 3 | 4;

export interface ReplyComposeInput {
  deeplinkUrl: string;
  productName?: string;
  accountId: string;
  dayOfWeek?: number; // 0-6
  variantOverride?: ReplyVariant;
}

export interface ReplyComposeResult {
  text: string;
  variantUsed: ReplyVariant;
}

const templates: Record<ReplyVariant, (deeplinkUrl: string, productName: string) => string> = {
  1: (link) => `[광고] 완전 급할 땐 이거 씀ㅋㅋ
➡️➡️${link}
"${LEGAL_DISCLAIMER}"`,

  2: (link) => `${LEGAL_DISCLAIMER}
•••••••••••••••••••••••••••••••••••••••••••••••••••
🔽 정보는 아래 링크에! 🔽
❤️${link}❤️`,

  3: (link) => `[광고] 주말에 이거만 한다 ㅋㅋㅋ
💕💕💕💕💕💕💕💕💕
${link}
${link}
💕💕💕💕💕💕💕💕💕
*${LEGAL_DISCLAIMER}`,

  4: (link, productName) => `"${LEGAL_DISCLAIMER}"
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ

🔽 ${productName} 정보 🔽

❤️${link}❤️
❤️${link}❤️

안사도 되니까 구경만 해요💗`,
};

function stableVariant(accountId: string, dayOfWeek: number): ReplyVariant {
  const h = createHash('sha256').update(`${accountId}|${dayOfWeek}`).digest();
  const n = h.readUInt8(0) % 4;
  return (n + 1) as ReplyVariant;
}

export function composeReply(input: ReplyComposeInput): ReplyComposeResult {
  const dow = input.dayOfWeek ?? new Date().getDay();
  let variant = input.variantOverride ?? stableVariant(input.accountId, dow);

  // 양식 4는 productName 필수 — 없으면 양식 1로 폴백
  if (variant === 4 && !input.productName) variant = 1;

  const productName = input.productName ?? '';
  let text = templates[variant](input.deeplinkUrl, productName);

  // 공정위 문구 미포함 시 강제 append (안전빵)
  if (!text.includes(LEGAL_DISCLAIMER)) {
    text = `${text}\n\n${LEGAL_DISCLAIMER}`;
  }

  return { text, variantUsed: variant };
}
